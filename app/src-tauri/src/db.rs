//! Tempro's own SQLite store. Raw tables are append-only except for the newest row of a
//! stream, whose duration grows while the same thing keeps happening (heartbeat merge).

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub fn data_dir() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join("Tempro")
}

pub fn db_path() -> PathBuf {
    data_dir().join("tempro.db")
}

const MIGRATIONS: &[&str] = &[
    // 1: raw streams, manual spans, key-value
    r#"
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    CREATE TABLE raw_window (
      id INTEGER PRIMARY KEY, ts REAL NOT NULL, dur REAL NOT NULL,
      app TEXT NOT NULL, title TEXT NOT NULL, exe TEXT, source TEXT NOT NULL DEFAULT 'tempro');
    CREATE INDEX raw_window_ts ON raw_window (ts);

    -- afk = 0 active, 1 away; kind: input | idle | lock | sleep
    CREATE TABLE raw_afk (
      id INTEGER PRIMARY KEY, ts REAL NOT NULL, dur REAL NOT NULL,
      afk INTEGER NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'tempro');
    CREATE INDEX raw_afk_ts ON raw_afk (ts);

    -- kind: audio (an app makes sound) | mic (an app holds the microphone)
    CREATE TABLE raw_media (
      id INTEGER PRIMARY KEY, ts REAL NOT NULL, dur REAL NOT NULL, kind TEXT NOT NULL, app TEXT NOT NULL);
    CREATE INDEX raw_media_ts ON raw_media (ts);

    -- counts only, never key codes
    CREATE TABLE raw_input (
      minute INTEGER PRIMARY KEY, keys INTEGER NOT NULL, clicks INTEGER NOT NULL,
      wheel INTEGER NOT NULL, moves INTEGER NOT NULL);

    CREATE TABLE raw_browser (
      id INTEGER PRIMARY KEY, ts REAL NOT NULL, dur REAL NOT NULL, url TEXT NOT NULL,
      title TEXT NOT NULL, browser TEXT NOT NULL, playing INTEGER NOT NULL, audible INTEGER NOT NULL);
    CREATE INDEX raw_browser_ts ON raw_browser (ts);

    -- text recognised on screen for apps whose title says nothing; images are never stored
    CREATE TABLE raw_ocr (
      id INTEGER PRIMARY KEY, ts REAL NOT NULL, app TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL);
    CREATE INDEX raw_ocr_ts ON raw_ocr (ts);

    -- user answers and timers: meeting | call | break | focus | other
    CREATE TABLE manual (
      id TEXT PRIMARY KEY, start REAL NOT NULL, "end" REAL NOT NULL, kind TEXT NOT NULL,
      project_id TEXT, note TEXT NOT NULL DEFAULT '', created REAL NOT NULL);
    CREATE INDEX manual_start ON manual (start);
    "#,
    // 2: old detail is compacted away. project NULL = untouched; otherwise the title is gone and the
    // project decided at that moment stays ('' = none); video keeps "was it a video" for the states
    r#"
    ALTER TABLE raw_window ADD COLUMN project TEXT;
    ALTER TABLE raw_window ADD COLUMN video INTEGER;
    "#,
];

/// The database key (64 hex chars), set once at startup before any connection opens.
static KEY: OnceLock<String> = OnceLock::new();

pub fn use_key(key: String) {
    let _ = KEY.set(key);
}

pub fn encrypted() -> bool {
    KEY.get().is_some()
}

fn apply_key(conn: &Connection, key: &str) -> rusqlite::Result<()> {
    // a raw key: no passphrase derivation, the key itself is random
    conn.execute_batch(&format!("PRAGMA key = \"x'{key}'\";"))
}

/// An unencrypted SQLite file starts with this header; an SQLCipher file looks like noise.
pub fn is_plaintext(path: &Path) -> bool {
    use std::io::Read;
    let mut head = [0u8; 16];
    std::fs::File::open(path).and_then(|mut f| f.read_exact(&mut head)).is_ok() && &head == b"SQLite format 3\0"
}

/// Turn the old unencrypted database into an encrypted one in place. The new file is written
/// and checked first; only then is the old one overwritten with zeros and removed.
pub fn encrypt_file(path: &Path, key: &str) -> Result<(), String> {
    let e = |e: rusqlite::Error| e.to_string();
    let tmp = path.with_extension("db.encrypting");
    let _ = std::fs::remove_file(&tmp);
    let plain = Connection::open(path).map_err(e)?;
    plain.busy_timeout(std::time::Duration::from_secs(10)).map_err(e)?;
    plain.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(())).map_err(e)?;
    let version: i64 = plain.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(e)?;
    let count = |c: &Connection| -> rusqlite::Result<(i64, i64, i64)> {
        c.query_row("SELECT (SELECT count(*) FROM raw_window), (SELECT count(*) FROM raw_afk), (SELECT count(*) FROM kv)", [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
    };
    let before = count(&plain).map_err(e)?;
    let tmp_s = tmp.to_string_lossy().replace('\'', "''");
    plain
        .execute_batch(&format!(
            "ATTACH DATABASE '{tmp_s}' AS enc KEY \"x'{key}'\"; SELECT sqlcipher_export('enc'); PRAGMA enc.user_version = {version}; DETACH DATABASE enc;"
        ))
        .map_err(e)?;
    drop(plain);

    let check = Connection::open(&tmp).map_err(e)?;
    apply_key(&check, key).map_err(e)?;
    let after = count(&check).map_err(|x| format!("the encrypted copy does not open: {x}"))?;
    drop(check);
    if after != before {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("the encrypted copy differs: {before:?} rows before, {after:?} after"));
    }
    for p in [path.to_path_buf(), path.with_extension("db-wal"), path.with_extension("db-shm")] {
        shred(&p);
    }
    std::fs::rename(&tmp, path).map_err(|x| x.to_string())
}

/// Overwrite with zeros, then delete: the old plaintext shouldn't linger in the file's clusters.
fn shred(path: &Path) {
    use std::io::Write;
    if let Ok(meta) = std::fs::metadata(path) {
        if let Ok(mut f) = std::fs::OpenOptions::new().write(true).open(path) {
            let zeros = vec![0u8; 1 << 20];
            let mut left = meta.len();
            while left > 0 {
                let n = left.min(zeros.len() as u64) as usize;
                if f.write_all(&zeros[..n]).is_err() {
                    break;
                }
                left -= n as u64;
            }
            let _ = f.sync_all();
        }
        let _ = std::fs::remove_file(path);
    }
}

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let conn = Connection::open(path)?;
    if let Some(key) = KEY.get() {
        apply_key(&conn, key)?;
    }
    // what is deleted (compacted titles) is zeroed on disk, not left in free pages
    conn.pragma_update(None, "secure_delete", "ON")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    migrate(&conn)?;
    Ok(conn)
}

pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(version as usize) {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

pub fn meta_get(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0)).optional().ok().flatten()
}

pub fn meta_set(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute("INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value])?;
    Ok(())
}

pub fn kv_get(conn: &Connection, key: &str) -> Option<Value> {
    let s: Option<String> = conn.query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0)).optional().ok().flatten();
    s.and_then(|s| serde_json::from_str(&s).ok())
}

pub fn kv_set(conn: &Connection, key: &str, value: &Value) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value.to_string()],
    )?;
    Ok(())
}

// ---------- settings ----------

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// no input for this long = away from the keyboard
    pub idle_seconds: u64,
    /// lowercase words: a title containing one is stored as "[скрыто]"
    pub hide_titles: Vec<String>,
    /// lowercase exe names whose titles are never stored
    pub hide_apps: Vec<String>,
    pub import_aw: bool,
    /// never | gaps
    pub screenshots: String,
    /// apps whose window title says nothing about the work: OCR looks at these in "gaps" mode
    pub blind_apps: Vec<String>,
    pub ocr_minutes: u64,
    /// none | ollama | claude
    pub ai_provider: String,
    pub ai_model: String,
    pub ai_key: String,
    /// empty = Anthropic; otherwise a proxy base like https://host/v1
    pub ai_base_url: String,
    /// name sessions with the model
    pub ai_titles: bool,
    /// let the model assign unassigned titles on its own (confident answers only)
    pub ai_auto: bool,
    pub ollama_url: String,
    pub ext_port: u16,
    pub question_minutes: u64,
    pub hotkey: String,
    /// window titles, tab addresses and screen text older than this many days are wiped;
    /// projects and minutes stay. 0 = keep everything
    pub detail_days: u64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            idle_seconds: 120,
            hide_titles: vec![],
            hide_apps: vec![],
            import_aw: true,
            screenshots: "never".into(),
            // not Telegram: its titles already name the chat, and screen text there is private
            blind_apps: ["claude.exe", "chatgpt.exe", "orca.exe"].map(String::from).to_vec(),
            ocr_minutes: 5,
            ai_provider: "none".into(),
            ai_model: String::new(),
            ai_key: String::new(),
            ai_base_url: String::new(),
            ai_titles: true,
            ai_auto: true,
            ollama_url: "http://127.0.0.1:11434".into(),
            ext_port: 5601,
            question_minutes: 15,
            hotkey: "Ctrl+Alt+T".into(),
            detail_days: 30,
        }
    }
}

/// The AI key lives in the Windows Credential Manager; the stored settings keep it empty.
/// A key left in the database by an older version is moved there on first load.
pub fn load_settings(conn: &Connection) -> Settings {
    let mut s: Settings = kv_get(conn, "settings").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
    if !s.ai_key.is_empty() {
        if crate::secrets::set(crate::secrets::AI_KEY, &s.ai_key).is_ok() {
            let _ = save_settings(conn, &s);
        }
    } else {
        s.ai_key = crate::secrets::get(crate::secrets::AI_KEY).unwrap_or_default();
    }
    s
}

pub fn save_settings(conn: &Connection, s: &Settings) -> rusqlite::Result<()> {
    let mut stored = serde_json::to_value(s).unwrap_or_default();
    // only when the credential store took it: losing the key would be worse than keeping it here
    if s.ai_key.is_empty() || crate::secrets::get(crate::secrets::AI_KEY).as_deref() == Some(s.ai_key.as_str()) {
        stored["aiKey"] = Value::String(String::new());
    }
    kv_set(conn, "settings", &stored)
}

// ---------- heartbeat writer ----------

struct Open {
    key: String,
    id: i64,
    ts: f64,
    last: f64,
    table: &'static str,
}

/// Owns the write connection. Streams: "window", "afk", "browser", "audio:<app>", "mic:<app>".
pub struct Writer {
    pub conn: Connection,
    open: HashMap<String, Open>,
}

pub enum Row<'a> {
    Window { app: &'a str, title: &'a str, exe: &'a str },
    Afk { afk: bool, kind: &'a str },
    Media { kind: &'a str, app: &'a str },
    Browser { url: &'a str, title: &'a str, browser: &'a str, playing: bool, audible: bool },
}

impl Row<'_> {
    fn key(&self) -> String {
        match self {
            Row::Window { app, title, .. } => format!("{app}\u{0}{title}"),
            Row::Afk { afk, kind } => format!("{afk}{kind}"),
            Row::Media { kind, app } => format!("{kind}{app}"),
            Row::Browser { url, title, playing, .. } => format!("{url}\u{0}{title}{playing}"),
        }
    }

    fn table(&self) -> &'static str {
        match self {
            Row::Window { .. } => "raw_window",
            Row::Afk { .. } => "raw_afk",
            Row::Media { .. } => "raw_media",
            Row::Browser { .. } => "raw_browser",
        }
    }

    fn insert(&self, conn: &Connection, ts: f64) -> rusqlite::Result<i64> {
        match self {
            Row::Window { app, title, exe } => conn.execute(
                "INSERT INTO raw_window (ts, dur, app, title, exe) VALUES (?1, 0, ?2, ?3, ?4)",
                params![ts, app, title, exe],
            ),
            Row::Afk { afk, kind } => conn.execute("INSERT INTO raw_afk (ts, dur, afk, kind) VALUES (?1, 0, ?2, ?3)", params![ts, *afk as i64, kind]),
            Row::Media { kind, app } => conn.execute("INSERT INTO raw_media (ts, dur, kind, app) VALUES (?1, 0, ?2, ?3)", params![ts, kind, app]),
            Row::Browser { url, title, browser, playing, audible } => conn.execute(
                "INSERT INTO raw_browser (ts, dur, url, title, browser, playing, audible) VALUES (?1, 0, ?2, ?3, ?4, ?5, ?6)",
                params![ts, url, title, browser, *playing as i64, *audible as i64],
            ),
        }?;
        Ok(conn.last_insert_rowid())
    }
}

impl Writer {
    pub fn new(conn: Connection) -> Self {
        Self { conn, open: HashMap::new() }
    }

    /// The same thing seen again within `pulse_ms` extends the open row; anything else starts a new one.
    /// `at` lets a state change be backdated (going idle starts when input stopped, not when we noticed).
    pub fn beat(&mut self, stream: &str, row: Row, now: f64, pulse_ms: f64, at: Option<f64>) -> rusqlite::Result<()> {
        let key = row.key();
        if let Some(o) = self.open.get_mut(stream) {
            if o.key == key && now - o.last <= pulse_ms {
                o.last = now;
                self.conn.execute(&format!("UPDATE {} SET dur = ?1 WHERE id = ?2", o.table), params![(now - o.ts) / 1000.0, o.id])?;
                return Ok(());
            }
        }
        let start = at.unwrap_or(now);
        // close the previous row at the switch, so streams stay contiguous
        if let Some(o) = self.open.get(stream) {
            if now - o.last <= pulse_ms {
                let end = start.max(o.ts);
                self.conn.execute(&format!("UPDATE {} SET dur = ?1 WHERE id = ?2", o.table), params![(end - o.ts) / 1000.0, o.id])?;
            }
        }
        let id = row.insert(&self.conn, start)?;
        let dur = (now - start).max(0.0) / 1000.0;
        if dur > 0.0 {
            self.conn.execute(&format!("UPDATE {} SET dur = ?1 WHERE id = ?2", row.table()), params![dur, id])?;
        }
        self.open.insert(stream.to_string(), Open { key, id, ts: start, last: now, table: row.table() });
        Ok(())
    }

    /// Streams that weren't refreshed stop on their own: forget them so the next beat starts fresh.
    pub fn expire(&mut self, now: f64, older_than_ms: f64, prefix: &str) {
        self.open.retain(|k, o| !(k.starts_with(prefix) && now - o.last > older_than_ms));
    }

    pub fn add_input(&mut self, minute: i64, keys: u32, clicks: u32, wheel: u32, moves: u32) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO raw_input (minute, keys, clicks, wheel, moves) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(minute) DO UPDATE SET keys = keys + excluded.keys, clicks = clicks + excluded.clicks,
               wheel = wheel + excluded.wheel, moves = moves + excluded.moves",
            params![minute, keys, clicks, wheel, moves],
        )?;
        Ok(())
    }

    pub fn add_ocr(&mut self, ts: f64, app: &str, title: &str, text: &str) -> rusqlite::Result<()> {
        self.conn.execute("INSERT INTO raw_ocr (ts, app, title, text) VALUES (?1, ?2, ?3, ?4)", params![ts, app, title, text])?;
        Ok(())
    }
}

// ---------- readers ----------

#[derive(Serialize)]
pub struct Events {
    pub window: Vec<Value>,
    pub afk: Vec<Value>,
    pub media: Vec<Value>,
    pub browser: Vec<Value>,
    pub ocr: Vec<Value>,
    pub manual: Vec<Value>,
    pub input: Vec<Value>,
}

/// Everything overlapping [from, to). Long rows (AFK, sleep) need a deeper look back.
pub fn read_events(conn: &Connection, from: f64, to: f64) -> rusqlite::Result<Events> {
    const H: f64 = 3_600_000.0;
    let rows = |sql: &str, lookback: f64, map: &dyn Fn(&rusqlite::Row) -> rusqlite::Result<Value>| -> rusqlite::Result<Vec<Value>> {
        let mut st = conn.prepare_cached(sql)?;
        let it = st.query_map(params![from - lookback, to, from], |r| map(r))?;
        it.collect()
    };
    let window = rows(
        "SELECT ts, dur, app, title, project, video FROM raw_window WHERE ts >= ?1 AND ts < ?2 AND ts + dur * 1000 > ?3 ORDER BY ts",
        12.0 * H,
        &|r| {
            let mut v = serde_json::json!({"ts": r.get::<_, f64>(0)?, "dur": r.get::<_, f64>(1)?, "app": r.get::<_, String>(2)?, "title": r.get::<_, String>(3)?});
            if let Some(p) = r.get::<_, Option<String>>(4)? {
                v["project"] = Value::String(p);
                v["video"] = Value::Bool(r.get::<_, Option<i64>>(5)?.unwrap_or(0) != 0);
            }
            Ok(v)
        },
    )?;
    let afk = rows(
        "SELECT ts, dur, afk, kind FROM raw_afk WHERE ts >= ?1 AND ts < ?2 AND ts + dur * 1000 > ?3 ORDER BY ts",
        72.0 * H,
        &|r| Ok(serde_json::json!({"ts": r.get::<_, f64>(0)?, "dur": r.get::<_, f64>(1)?, "afk": r.get::<_, i64>(2)? != 0, "kind": r.get::<_, String>(3)?})),
    )?;
    let media = rows(
        "SELECT ts, dur, kind, app FROM raw_media WHERE ts >= ?1 AND ts < ?2 AND ts + dur * 1000 > ?3 ORDER BY ts",
        12.0 * H,
        &|r| Ok(serde_json::json!({"ts": r.get::<_, f64>(0)?, "dur": r.get::<_, f64>(1)?, "kind": r.get::<_, String>(2)?, "app": r.get::<_, String>(3)?})),
    )?;
    let browser = rows(
        "SELECT ts, dur, url, title, browser, playing, audible FROM raw_browser WHERE ts >= ?1 AND ts < ?2 AND ts + dur * 1000 > ?3 ORDER BY ts",
        12.0 * H,
        &|r| {
            Ok(serde_json::json!({"ts": r.get::<_, f64>(0)?, "dur": r.get::<_, f64>(1)?, "url": r.get::<_, String>(2)?, "title": r.get::<_, String>(3)?,
                "browser": r.get::<_, String>(4)?, "playing": r.get::<_, i64>(5)? != 0, "audible": r.get::<_, i64>(6)? != 0}))
        },
    )?;
    let ocr = rows(
        "SELECT ts, 0, app, title, text FROM raw_ocr WHERE ts >= ?1 AND ts < ?2 AND ts >= ?3 ORDER BY ts",
        0.0,
        &|r| Ok(serde_json::json!({"ts": r.get::<_, f64>(0)?, "app": r.get::<_, String>(2)?, "title": r.get::<_, String>(3)?, "text": r.get::<_, String>(4)?})),
    )?;
    let manual = rows(
        r#"SELECT id, start, "end", kind, project_id, note FROM manual WHERE start >= ?1 AND start < ?2 AND "end" > ?3 ORDER BY start"#,
        72.0 * H,
        &|r| {
            Ok(serde_json::json!({"id": r.get::<_, String>(0)?, "start": r.get::<_, f64>(1)?, "end": r.get::<_, f64>(2)?, "kind": r.get::<_, String>(3)?,
                "projectId": r.get::<_, Option<String>>(4)?, "note": r.get::<_, String>(5)?}))
        },
    )?;
    let input = rows(
        "SELECT minute, keys, clicks, wheel, moves FROM raw_input WHERE minute * 60000 >= ?1 AND minute * 60000 < ?2 AND minute * 60000 >= ?3 ORDER BY minute",
        0.0,
        &|r| Ok(serde_json::json!({"minute": r.get::<_, i64>(0)?, "keys": r.get::<_, i64>(1)?, "clicks": r.get::<_, i64>(2)?, "wheel": r.get::<_, i64>(3)?, "moves": r.get::<_, i64>(4)?})),
    )?;
    Ok(Events { window, afk, media, browser, ocr, manual, input })
}

// ---------- keeping less: old detail is compacted away ----------

/// Start of the oldest window row before `before` that still has its detail.
pub fn compact_todo(conn: &Connection, before: f64) -> rusqlite::Result<Option<f64>> {
    conn.query_row("SELECT min(ts) FROM raw_window WHERE project IS NULL AND ts < ?1", [before], |r| r.get(0))
}

/// Forget the detail of everything that started before `until` (never after `before`): window titles
/// go, the project the rules gave each row at this moment stays; tab addresses and titles go; screen
/// text is deleted. `pins`: [ts, project or "", was it a video].
pub fn compact(conn: &Connection, before: f64, until: f64, pins: &[(f64, String, bool)]) -> rusqlite::Result<usize> {
    let until = until.min(before);
    let tx = conn.unchecked_transaction()?;
    let mut n = 0;
    {
        let mut st = tx.prepare_cached("UPDATE raw_window SET project = ?2, video = ?3, title = '' WHERE ts = ?1 AND ts < ?4 AND project IS NULL")?;
        for (ts, project, video) in pins {
            n += st.execute(params![ts, project, *video as i64, until])?;
        }
    }
    // anything the caller didn't pin (zero-length rows) loses its detail too
    n += tx.execute("UPDATE raw_window SET project = '', video = 0, title = '' WHERE ts < ?1 AND project IS NULL", [until])?;
    tx.execute("UPDATE raw_browser SET url = '', title = '' WHERE ts < ?1 AND (url != '' OR title != '')", [until])?;
    tx.execute("DELETE FROM raw_ocr WHERE ts < ?1", [until])?;
    tx.commit()?;
    Ok(n)
}

/// Newest raw rows of every stream, for the Journal screen.
pub fn journal(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<Value>> {
    let mut out = Vec::new();
    let mut q = |sql: &str, stream: &str| -> rusqlite::Result<()> {
        let mut st = conn.prepare(sql)?;
        let rows = st.query_map([limit], |r| {
            Ok(serde_json::json!({"stream": stream, "id": r.get::<_, i64>(0)?, "ts": r.get::<_, f64>(1)?, "dur": r.get::<_, f64>(2)?,
                "a": r.get::<_, String>(3)?, "b": r.get::<_, String>(4)?, "source": r.get::<_, String>(5)?}))
        })?;
        for row in rows {
            out.push(row?);
        }
        Ok(())
    };
    q("SELECT id, ts, dur, app, title, source FROM raw_window ORDER BY ts DESC LIMIT ?1", "window")?;
    q("SELECT id, ts, dur, CASE afk WHEN 1 THEN 'отошёл' ELSE 'на месте' END, kind, source FROM raw_afk ORDER BY ts DESC LIMIT ?1", "afk")?;
    q("SELECT id, ts, dur, kind, app, 'tempro' FROM raw_media ORDER BY ts DESC LIMIT ?1", "media")?;
    q("SELECT id, ts, dur, browser, url, 'extension' FROM raw_browser ORDER BY ts DESC LIMIT ?1", "browser")?;
    q("SELECT id, ts, 0.0, app, substr(text, 1, 160), 'ocr' FROM raw_ocr ORDER BY ts DESC LIMIT ?1", "ocr")?;
    out.sort_by(|a, b| b["ts"].as_f64().partial_cmp(&a["ts"].as_f64()).unwrap_or(std::cmp::Ordering::Equal));
    out.truncate(limit as usize);
    Ok(out)
}

pub fn counts(conn: &Connection) -> rusqlite::Result<Value> {
    let c = |t: &str| -> rusqlite::Result<i64> { conn.query_row(&format!("SELECT count(*) FROM {t}"), [], |r| r.get(0)) };
    let src = |s: &str| -> rusqlite::Result<i64> { conn.query_row("SELECT count(*) FROM raw_window WHERE source = ?1", [s], |r| r.get(0)) };
    let first_own: Option<f64> = conn.query_row("SELECT min(ts) FROM raw_window WHERE source = 'tempro'", [], |r| r.get(0))?;
    let last: Option<f64> = conn.query_row("SELECT max(ts + dur * 1000) FROM raw_window", [], |r| r.get(0))?;
    Ok(serde_json::json!({
        "window": c("raw_window")?, "windowOwn": src("tempro")?, "windowAw": src("aw")?,
        "afk": c("raw_afk")?, "media": c("raw_media")?, "browser": c("raw_browser")?, "ocr": c("raw_ocr")?,
        "manual": c("manual")?, "firstOwn": first_own, "lastEvent": last,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Writer {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        Writer::new(conn)
    }

    fn rows(w: &Writer) -> Vec<(f64, f64, String)> {
        let mut st = w.conn.prepare("SELECT ts, dur, title FROM raw_window ORDER BY ts").unwrap();
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().map(|r| r.unwrap()).collect()
    }

    #[test]
    fn same_window_extends_one_row() {
        let mut w = mem();
        for t in [0.0, 2000.0, 4000.0, 6000.0] {
            w.beat("window", Row::Window { app: "a.exe", title: "x", exe: "" }, t, 5000.0, None).unwrap();
        }
        assert_eq!(rows(&w), vec![(0.0, 6.0, "x".into())]);
    }

    #[test]
    fn switch_closes_previous_at_switch_time() {
        let mut w = mem();
        w.beat("window", Row::Window { app: "a.exe", title: "x", exe: "" }, 0.0, 5000.0, None).unwrap();
        w.beat("window", Row::Window { app: "a.exe", title: "x", exe: "" }, 2000.0, 5000.0, None).unwrap();
        w.beat("window", Row::Window { app: "a.exe", title: "y", exe: "" }, 3000.0, 5000.0, None).unwrap();
        assert_eq!(rows(&w), vec![(0.0, 3.0, "x".into()), (3000.0, 0.0, "y".into())]);
    }

    #[test]
    fn gap_longer_than_pulse_starts_new_row() {
        let mut w = mem();
        w.beat("window", Row::Window { app: "a.exe", title: "x", exe: "" }, 0.0, 5000.0, None).unwrap();
        w.beat("window", Row::Window { app: "a.exe", title: "x", exe: "" }, 60_000.0, 5000.0, None).unwrap();
        assert_eq!(rows(&w).len(), 2);
        assert_eq!(rows(&w)[0].1, 0.0, "the tracker was off: no time is invented");
    }

    #[test]
    fn backdated_state_change() {
        let mut w = mem();
        w.beat("afk", Row::Afk { afk: false, kind: "input" }, 0.0, f64::INFINITY, None).unwrap();
        w.beat("afk", Row::Afk { afk: false, kind: "input" }, 100_000.0, f64::INFINITY, None).unwrap();
        // noticed at 220 s that input stopped at 100 s
        w.beat("afk", Row::Afk { afk: true, kind: "idle" }, 220_000.0, f64::INFINITY, Some(100_000.0)).unwrap();
        let got: Vec<(f64, f64, i64)> = w
            .conn
            .prepare("SELECT ts, dur, afk FROM raw_afk ORDER BY ts")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(got, vec![(0.0, 100.0, 0), (100_000.0, 120.0, 1)]);
    }

    #[test]
    fn compaction_keeps_projects_and_drops_titles() {
        let w = mem();
        w.conn
            .execute_batch(
                "INSERT INTO raw_window (ts, dur, app, title) VALUES (1000, 5, 'figma.exe', 'aurora — сайт'), (2000, 0, 'a.exe', 'x'), (9000, 5, 'b.exe', 'новое');
                 INSERT INTO raw_browser (ts, dur, url, title, browser, playing, audible) VALUES (1000, 5, 'https://x', 'X', 'edge', 1, 0);
                 INSERT INTO raw_ocr (ts, app, title, text) VALUES (1000, 'a', 'b', 'секрет');",
            )
            .unwrap();
        assert_eq!(compact_todo(&w.conn, 5000.0).unwrap(), Some(1000.0));
        compact(&w.conn, 5000.0, 5000.0, &[(1000.0, "p_aurora".into(), false)]).unwrap();
        let rows: Vec<(String, Option<String>)> = w
            .conn
            .prepare("SELECT title, project FROM raw_window ORDER BY ts")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(rows, vec![("".into(), Some("p_aurora".into())), ("".into(), Some("".into())), ("новое".into(), None)]);
        let (url, playing): (String, i64) = w.conn.query_row("SELECT url, playing FROM raw_browser", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((url.as_str(), playing), ("", 1), "the address goes, \"a video was playing\" stays");
        let ocr: i64 = w.conn.query_row("SELECT count(*) FROM raw_ocr", [], |r| r.get(0)).unwrap();
        assert_eq!(ocr, 0);
        assert_eq!(compact_todo(&w.conn, 5000.0).unwrap(), None);
        let ev = read_events(&w.conn, 0.0, 10_000.0).unwrap();
        assert_eq!(ev.window[0]["project"], "p_aurora");
        assert!(ev.window[2].get("project").is_none());
    }

    #[test]
    fn plaintext_database_is_encrypted_in_place() {
        let dir = std::env::temp_dir().join(format!("tempro-enc-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.db");
        {
            let c = Connection::open(&path).unwrap();
            migrate(&c).unwrap();
            c.execute("INSERT INTO raw_window (ts, dur, app, title) VALUES (1, 1, 'a.exe', 'секретный заголовок')", []).unwrap();
        }
        assert!(is_plaintext(&path));
        let key = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
        encrypt_file(&path, key).unwrap();
        assert!(!is_plaintext(&path));
        let raw = std::fs::read(&path).unwrap();
        assert!(!raw.windows("секрет".len()).any(|w| w == "секрет".as_bytes()));
        let c = Connection::open(&path).unwrap();
        apply_key(&c, key).unwrap();
        let t: String = c.query_row("SELECT title FROM raw_window", [], |r| r.get(0)).unwrap();
        assert_eq!(t, "секретный заголовок");
        let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v as usize, MIGRATIONS.len());
        drop(c);
        let wrong = Connection::open(&path).unwrap();
        apply_key(&wrong, "ff112233445566778899aabbccddeeff00112233445566778899aabbccddeeff").unwrap();
        assert!(wrong.query_row("SELECT count(*) FROM raw_window", [], |r| r.get::<_, i64>(0)).is_err());
        drop(wrong);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn input_counts_accumulate() {
        let mut w = mem();
        w.add_input(5, 3, 1, 0, 2).unwrap();
        w.add_input(5, 2, 0, 1, 0).unwrap();
        let k: i64 = w.conn.query_row("SELECT keys FROM raw_input WHERE minute = 5", [], |r| r.get(0)).unwrap();
        assert_eq!(k, 5);
    }
}
