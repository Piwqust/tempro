//! Claude Code sessions from ~/.claude/projects/<folder>/*.jsonl: when an agent worked and in which folder.
//! Lines can be megabytes (tool results), so we only look for the two keys we need instead of parsing JSON.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use crate::timeutil::{now_ms, parse_utc};

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
pub struct AgentSpan {
    pub start: f64,
    pub end: f64,
    pub cwd: String,
    pub session: String,
    /// claude-desktop | cli | …
    pub entry: String,
}

/// A pause longer than this splits a session into two spans.
const GAP_MS: f64 = 5.0 * 60_000.0;
/// The last message still means the agent (or you, reading it) was busy for a bit.
const TAIL_MS: f64 = 60_000.0;
/// A file still being written is saved to the database at most this often; after a restart only
/// what was added since is read again.
const SAVE_EVERY_MS: f64 = 10.0 * 60_000.0;

/// What is known about one session file. Claude Code only ever appends to a transcript, so a
/// file that grew is read from where the last read stopped, never again from the start: the
/// active sessions are the biggest files (100+ MB) and they change every few seconds.
#[derive(Default)]
struct Parsed {
    /// nanoseconds since the epoch, as the file system reported it when we last read the file
    mtime: Option<i64>,
    /// bytes already read, always at the end of a whole line
    offset: u64,
    cwd: String,
    entry: String,
    spans: Vec<AgentSpan>,
    /// when this state was last written to the database (0 = never)
    saved: f64,
    /// read further than what the database has
    changed: bool,
}

impl Parsed {
    fn feed(&mut self, line: &str, session: &str) {
        if let Some(c) = last_string(line, "\"cwd\":\"") {
            self.cwd = c;
        }
        if let Some(e) = last_string(line, "\"entrypoint\":\"") {
            self.entry = e;
        }
        let Some(ts) = last_string(line, "\"timestamp\":\"").and_then(|t| parse_utc(&t)) else { return };
        if self.cwd.is_empty() {
            return;
        }
        match self.spans.last_mut() {
            Some(s) if s.cwd == self.cwd && ts >= s.start && ts - (s.end - TAIL_MS) <= GAP_MS => s.end = s.end.max(ts + TAIL_MS),
            _ => self.spans.push(AgentSpan { start: ts, end: ts + TAIL_MS, cwd: self.cwd.clone(), session: session.into(), entry: self.entry.clone() }),
        }
    }

    /// Read the lines added since the last call. A line still being written (no newline yet)
    /// is left for the next call.
    fn catch_up(&mut self, p: &Path) {
        let Ok(mut f) = std::fs::File::open(p) else { return };
        let len = f.metadata().map(|m| m.len()).unwrap_or(0);
        if len < self.offset {
            // shorter than what we read: not the same file any more
            *self = Parsed { saved: self.saved, changed: true, ..Parsed::default() };
        }
        if len == self.offset || f.seek(SeekFrom::Start(self.offset)).is_err() {
            return;
        }
        let session = p.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        let mut r = BufReader::with_capacity(1 << 16, f);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match r.read_until(b'\n', &mut buf) {
                Ok(n) if n > 0 && buf.last() == Some(&b'\n') => {
                    self.offset += n as u64;
                    self.changed = true;
                    self.feed(&String::from_utf8_lossy(&buf), &session);
                }
                _ => break,
            }
        }
    }
}

static CACHE: Mutex<Option<HashMap<PathBuf, Parsed>>> = Mutex::new(None);

fn nanos(t: SystemTime) -> i64 {
    t.duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_nanos() as i64).unwrap_or(0)
}

/// What earlier runs already read. Without it every start would read all the sessions of the
/// range again: a month of them is ~10 GB.
fn load(conn: &Connection) -> HashMap<PathBuf, Parsed> {
    let mut out = HashMap::new();
    let Ok(mut st) = conn.prepare("SELECT path, mtime, bytes, cwd, entry, spans FROM agent_file") else { return out };
    let Ok(rows) = st.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?, r.get::<_, String>(5)?))
    }) else {
        return out;
    };
    let now = now_ms();
    for (path, mtime, bytes, cwd, entry, spans) in rows.flatten() {
        // a row that doesn't read back is simply read again from the file
        let Ok(spans) = serde_json::from_str(&spans) else { continue };
        out.insert(PathBuf::from(path), Parsed { mtime: Some(mtime), offset: bytes.max(0) as u64, cwd, entry, spans, saved: now, changed: false });
    }
    out
}

fn save(conn: &Connection, cache: &mut HashMap<PathBuf, Parsed>, now: f64) {
    let due: Vec<PathBuf> = cache.iter().filter(|(_, p)| p.changed && (p.saved == 0.0 || now - p.saved >= SAVE_EVERY_MS)).map(|(k, _)| k.clone()).collect();
    if due.is_empty() {
        return;
    }
    let Ok(tx) = conn.unchecked_transaction() else { return };
    for path in &due {
        let p = &cache[path];
        let r = tx.execute(
            "INSERT INTO agent_file (path, mtime, bytes, cwd, entry, spans) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime, bytes = excluded.bytes, cwd = excluded.cwd,
               entry = excluded.entry, spans = excluded.spans",
            params![path.to_string_lossy(), p.mtime.unwrap_or(0), p.offset as i64, p.cwd, p.entry, serde_json::to_string(&p.spans).unwrap_or_else(|_| "[]".into())],
        );
        if let Err(e) = r {
            return eprintln!("agents: {e}");
        }
    }
    if tx.commit().is_ok() {
        for path in &due {
            if let Some(p) = cache.get_mut(path) {
                p.saved = now;
                p.changed = false;
            }
        }
    }
}

pub fn root() -> PathBuf {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default();
    PathBuf::from(home).join(".claude").join("projects")
}

/// `db` is locked only briefly, to load what earlier runs read and to save what this one added.
pub fn spans(root: &Path, from: f64, to: f64, db: &Mutex<Connection>) -> Vec<AgentSpan> {
    let since = SystemTime::UNIX_EPOCH + std::time::Duration::from_millis(from.max(0.0) as u64);
    let mut out = Vec::new();
    let Ok(dirs) = std::fs::read_dir(root) else { return out };
    let mut cache = CACHE.lock().unwrap();
    let cache = cache.get_or_insert_with(|| load(&db.lock().unwrap()));
    for dir in dirs.flatten() {
        let Ok(files) = std::fs::read_dir(dir.path()) else { continue };
        for f in files.flatten() {
            let p = f.path();
            if p.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Ok(mtime) = f.metadata().and_then(|m| m.modified()) else { continue };
            if mtime < since {
                continue; // nothing in this file can reach into the range
            }
            let known = cache.entry(p).or_default();
            if known.mtime != Some(nanos(mtime)) {
                known.catch_up(&f.path());
                known.mtime = Some(nanos(mtime));
                known.changed = true;
            }
            out.extend(known.spans.iter().filter(|s| s.end > from && s.start < to).cloned());
        }
    }
    save(&db.lock().unwrap(), cache, now_ms());
    out.sort_by(|a, b| a.start.total_cmp(&b.start));
    out
}

fn last_string(line: &str, key: &str) -> Option<String> {
    let at = line.rfind(key)? + key.len();
    let rest = &line[at..];
    let mut out = String::new();
    let mut chars = rest.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => return Some(out),
            '\\' => match chars.next()? {
                'n' => out.push('\n'),
                't' => out.push('\t'),
                'u' => {
                    let hex: String = chars.by_ref().take(4).collect();
                    out.push(char::from_u32(u32::from_str_radix(&hex, 16).ok()?).unwrap_or('?'));
                }
                other => out.push(other),
            },
            c => out.push(c),
        }
    }
    None
}

#[cfg(test)]
fn parse_lines(lines: impl Iterator<Item = String>, session: &str) -> Vec<AgentSpan> {
    let mut p = Parsed::default();
    for line in lines {
        p.feed(&line, session);
    }
    p.spans
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spans_split_on_long_pause_and_unescape_paths() {
        let l = |t: &str| format!(r#"{{"type":"user","timestamp":"{t}","cwd":"C:\\Users\\me\\proj","entrypoint":"cli"}}"#);
        let lines = vec![l("2026-10-16T10:00:00.000Z"), l("2026-10-16T10:03:00.000Z"), l("2026-10-16T11:00:00.000Z")];
        let s = parse_lines(lines.into_iter(), "abc");
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].cwd, r"C:\Users\me\proj");
        assert_eq!(s[0].end - s[0].start, 4.0 * 60_000.0);
        assert_eq!(s[0].entry, "cli");
    }

    #[test]
    fn a_growing_file_is_read_from_where_it_stopped() {
        use std::io::Write;
        let dir = std::env::temp_dir().join(format!("tempro-agents-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.jsonl");
        let l = |t: &str| format!("{{\"timestamp\":\"{t}\",\"cwd\":\"C:\\\\p\"}}\n");
        let mut f = std::fs::File::create(&path).unwrap();
        write!(f, "{}", l("2026-10-16T10:00:00Z")).unwrap();
        // a line the writer hasn't finished yet
        write!(f, "{{\"timestamp\":\"2026-10-16T10:02:00Z\",\"cw").unwrap();
        f.flush().unwrap();

        let mut p = Parsed::default();
        p.catch_up(&path);
        let first = p.offset;
        assert_eq!(p.spans.len(), 1);
        assert_eq!(p.spans[0].end - p.spans[0].start, TAIL_MS, "the half-written line is not read yet");

        write!(f, "d\":\"C:\\\\p\"}}\n{}", l("2026-10-16T11:00:00Z")).unwrap();
        f.flush().unwrap();
        p.catch_up(&path);
        assert!(p.offset > first);
        assert_eq!(p.offset, std::fs::metadata(&path).unwrap().len());
        assert_eq!(p.spans.len(), 2);
        assert_eq!(p.spans[0].end - p.spans[0].start, 2.0 * 60_000.0 + TAIL_MS);
        assert_eq!(p.spans[0].cwd, r"C:\p");

        // replaced by a shorter file: start over
        drop(f);
        std::fs::write(&path, l("2026-10-17T09:00:00Z")).unwrap();
        p.catch_up(&path);
        assert_eq!(p.spans.len(), 1);
        assert_eq!(p.spans[0].start, parse_utc("2026-10-17T09:00:00Z").unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn what_was_read_survives_a_restart() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        let dir = std::env::temp_dir().join(format!("tempro-agents-db-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.jsonl");
        std::fs::write(&path, "{\"timestamp\":\"2026-10-16T10:00:00Z\",\"cwd\":\"C:\\\\p\",\"entrypoint\":\"cli\"}\n").unwrap();

        let mut p = Parsed::default();
        p.catch_up(&path);
        p.mtime = Some(42);
        let mut cache = HashMap::from([(path.clone(), p)]);
        save(&conn, &mut cache, 1_000.0);
        assert!(!cache[&path].changed);

        let back = load(&conn);
        let q = &back[&path];
        assert_eq!((q.mtime, q.offset), (Some(42), std::fs::metadata(&path).unwrap().len()));
        assert_eq!(q.spans, cache[&path].spans);
        assert_eq!((q.cwd.as_str(), q.entry.as_str()), (r"C:\p", "cli"));

        // still being written: saved again only after a while
        cache.get_mut(&path).unwrap().changed = true;
        save(&conn, &mut cache, 2_000.0);
        assert!(cache[&path].changed);
        save(&conn, &mut cache, 1_000.0 + SAVE_EVERY_MS);
        assert!(!cache[&path].changed);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn nested_timestamps_use_the_last_key() {
        let line = r#"{"toolUseResult":{"timestamp":"2020-01-01T00:00:00Z"},"cwd":"C:\\x","timestamp":"2026-10-16T10:00:00Z"}"#;
        let s = parse_lines(std::iter::once(line.to_string()), "s");
        assert_eq!(s[0].start, parse_utc("2026-10-16T10:00:00Z").unwrap());
    }
}
