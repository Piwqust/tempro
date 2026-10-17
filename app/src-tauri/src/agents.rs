//! Claude Code sessions from ~/.claude/projects/<folder>/*.jsonl: when an agent worked and in which folder.
//! Lines can be megabytes (tool results), so we only look for the two keys we need instead of parsing JSON.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use crate::timeutil::parse_utc;

#[derive(Clone, Serialize)]
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

static CACHE: Mutex<Option<HashMap<PathBuf, (SystemTime, Vec<AgentSpan>)>>> = Mutex::new(None);

pub fn root() -> PathBuf {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default();
    PathBuf::from(home).join(".claude").join("projects")
}

pub fn spans(root: &Path, from: f64, to: f64) -> Vec<AgentSpan> {
    let since = SystemTime::UNIX_EPOCH + std::time::Duration::from_millis(from.max(0.0) as u64);
    let mut out = Vec::new();
    let Ok(dirs) = std::fs::read_dir(root) else { return out };
    let mut cache = CACHE.lock().unwrap();
    let cache = cache.get_or_insert_with(HashMap::new);
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
            let spans = match cache.get(&p) {
                Some((t, s)) if *t == mtime => s.clone(),
                _ => {
                    let s = parse_file(&p);
                    cache.insert(p.clone(), (mtime, s.clone()));
                    s
                }
            };
            out.extend(spans.into_iter().filter(|s| s.end > from && s.start < to));
        }
    }
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

fn parse_file(p: &Path) -> Vec<AgentSpan> {
    let Ok(f) = std::fs::File::open(p) else { return vec![] };
    let session = p.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
    parse_lines(BufReader::new(f).lines().map_while(Result::ok), &session)
}

fn parse_lines(lines: impl Iterator<Item = String>, session: &str) -> Vec<AgentSpan> {
    let mut out: Vec<AgentSpan> = Vec::new();
    let (mut cwd, mut entry) = (String::new(), String::new());
    for line in lines {
        if let Some(c) = last_string(&line, "\"cwd\":\"") {
            cwd = c;
        }
        if let Some(e) = last_string(&line, "\"entrypoint\":\"") {
            entry = e;
        }
        let Some(ts) = last_string(&line, "\"timestamp\":\"").and_then(|t| parse_utc(&t)) else { continue };
        if cwd.is_empty() {
            continue;
        }
        match out.last_mut() {
            Some(s) if s.cwd == cwd && ts >= s.start && ts - (s.end - TAIL_MS) <= GAP_MS => s.end = s.end.max(ts + TAIL_MS),
            _ => out.push(AgentSpan { start: ts, end: ts + TAIL_MS, cwd: cwd.clone(), session: session.into(), entry: entry.clone() }),
        }
    }
    out
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
    fn nested_timestamps_use_the_last_key() {
        let line = r#"{"toolUseResult":{"timestamp":"2020-01-01T00:00:00Z"},"cwd":"C:\\x","timestamp":"2026-10-16T10:00:00Z"}"#;
        let s = parse_lines(std::iter::once(line.to_string()), "s");
        assert_eq!(s[0].start, parse_utc("2026-10-16T10:00:00Z").unwrap());
    }
}
