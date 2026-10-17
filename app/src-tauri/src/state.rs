//! App state shared by Tauri commands, the extension server and the writer thread.

use rusqlite::Connection;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, OnceLock, RwLock};

use crate::db::{self, Row, Settings, Writer};
use crate::ocr::OcrSignal;
use crate::sensors::Signal;
use crate::timeutil::now_ms;

pub enum Msg {
    Sensor(Signal),
    Ocr(OcrSignal),
    Browser { url: String, title: String, browser: String, playing: bool, audible: bool },
}

#[derive(Default)]
pub struct Status {
    pub ext_last_seen: f64,
    pub ext_browser: String,
    pub import: Value,
    pub sensors_since: f64,
    pub last_signal: f64,
}

pub struct AppState {
    pub db_path: PathBuf,
    pub read: Mutex<Connection>,
    pub tx: Sender<Msg>,
    pub settings: Arc<RwLock<Settings>>,
    pub status: Mutex<Status>,
    pub idle_ms: Arc<AtomicU64>,
    /// "pause recording" from the tray: nothing is written while set
    pub paused: AtomicBool,
    pub app: OnceLock<tauri::AppHandle>,
}

impl AppState {
    pub fn settings(&self) -> Settings {
        self.settings.read().unwrap().clone()
    }
}

/// Titles that must not be stored are replaced before they ever reach the database.
pub fn scrub_title(s: &Settings, app: &str, title: &str) -> String {
    let a = app.to_lowercase();
    if s.hide_apps.iter().any(|h| h.eq_ignore_ascii_case(&a)) {
        return String::new();
    }
    let t = title.to_lowercase();
    if s.hide_titles.iter().any(|w| !w.trim().is_empty() && t.contains(&w.trim().to_lowercase())) {
        return "[скрыто]".into();
    }
    title.to_string()
}

struct Live {
    locked: bool,
    sleeping: bool,
    idle_ms: u64,
}

pub fn spawn_writer(state: Arc<AppState>, conn: Connection, rx: Receiver<Msg>) {
    std::thread::Builder::new()
        .name("tempro-writer".into())
        .spawn(move || {
            let mut w = Writer::new(conn);
            let mut live = Live { locked: false, sleeping: false, idle_ms: 0 };
            loop {
                let msg = match rx.recv_timeout(std::time::Duration::from_secs(5)) {
                    Ok(m) => m,
                    Err(RecvTimeoutError::Timeout) => continue,
                    Err(RecvTimeoutError::Disconnected) => break,
                };
                if state.paused.load(Ordering::Relaxed) {
                    continue;
                }
                let now = now_ms();
                state.status.lock().unwrap().last_signal = now;
                if let Err(e) = handle(&state, &mut w, &mut live, msg, now) {
                    eprintln!("writer: {e}");
                }
            }
        })
        .expect("spawn writer");
}

fn afk_beat(w: &mut Writer, live: &Live, idle_limit_ms: u64, now: f64) -> rusqlite::Result<()> {
    let (afk, kind, at) = if live.sleeping {
        (true, "sleep", None)
    } else if live.locked {
        (true, "lock", None)
    } else if live.idle_ms >= idle_limit_ms {
        // away started when input stopped, not when we noticed
        (true, "idle", Some(now - live.idle_ms as f64))
    } else {
        (false, "input", None)
    };
    w.beat("afk", Row::Afk { afk, kind }, now, f64::INFINITY, at)
}

fn handle(state: &AppState, w: &mut Writer, live: &mut Live, msg: Msg, now: f64) -> rusqlite::Result<()> {
    let s = state.settings();
    match msg {
        Msg::Sensor(Signal::Window { app, exe, title }) => {
            if !live.locked && !live.sleeping {
                let title = scrub_title(&s, &app, &title);
                w.beat("window", Row::Window { app: &app, title: &title, exe: &exe }, now, 5_000.0, None)?;
            }
        }
        Msg::Sensor(Signal::Tick { idle_ms, input }) => {
            live.idle_ms = idle_ms;
            state.idle_ms.store(idle_ms, Ordering::Relaxed);
            if input.iter().any(|&n| n > 0) {
                w.add_input((now / 60_000.0).floor() as i64, input[0], input[1], input[2], input[3])?;
            }
            afk_beat(w, live, s.idle_seconds * 1000, now)?;
        }
        Msg::Sensor(Signal::Media { audio, mic }) => {
            if !live.locked && !live.sleeping {
                for a in &audio {
                    w.beat(&format!("audio:{a}"), Row::Media { kind: "audio", app: a }, now, 25_000.0, None)?;
                }
                for a in &mic {
                    w.beat(&format!("mic:{a}"), Row::Media { kind: "mic", app: a }, now, 25_000.0, None)?;
                }
            }
            w.expire(now, 25_000.0, "audio:");
            w.expire(now, 25_000.0, "mic:");
        }
        Msg::Sensor(Signal::Locked(v)) => {
            live.locked = v;
            if v {
                crate::lock::relock();
            }
            afk_beat(w, live, s.idle_seconds * 1000, now)?;
        }
        Msg::Sensor(Signal::Sleeping(v)) => {
            if !v {
                // extend the sleep row up to the moment we woke
                afk_beat(w, live, s.idle_seconds * 1000, now)?;
            }
            live.sleeping = v;
            afk_beat(w, live, s.idle_seconds * 1000, now)?;
        }
        Msg::Ocr(OcrSignal::Text { app, title, text }) => {
            let title = scrub_title(&s, &app, &title);
            w.add_ocr(now, &app, &title, &text)?;
        }
        Msg::Browser { url, title, browser, playing, audible } => {
            let title = scrub_title(&s, &browser, &title);
            w.beat("browser", Row::Browser { url: &url, title: &title, browser: &browser, playing, audible }, now, 45_000.0, None)?;
            let mut st = state.status.lock().unwrap();
            st.ext_last_seen = now;
            st.ext_browser = browser;
        }
    }
    Ok(())
}

pub fn run_import(state: &AppState) -> Value {
    let path = crate::aw::default_db_path();
    if !path.exists() {
        let v = json!({"state": "none", "message": "База ActivityWatch не найдена"});
        state.status.lock().unwrap().import = v.clone();
        return v;
    }
    let prev = state.status.lock().unwrap().import.clone();
    state.status.lock().unwrap().import = json!({"state": "running"});
    let result = (|| -> Result<(crate::aw::ImportResult, crate::aw::ImportResult), String> {
        let conn = db::open(&state.db_path).map_err(|e| e.to_string())?;
        let own: f64 = db::meta_get(&conn, "own_start").and_then(|s| s.parse().ok()).unwrap_or_else(now_ms);
        if let Some(cats) = crate::aw::read_categories(&crate::aw::settings_path()) {
            let _ = db::kv_set(&conn, "aw_categories", &cats);
        }
        let before = crate::aw::import(&path, &conn, own)?;
        let gaps = crate::aw::import_gaps(&path, &conn, own, now_ms())?;
        Ok((before, gaps))
    })();
    // counts add up across the periodic runs of this session
    let total = |k: &str| prev[k].as_u64().unwrap_or(0) as usize;
    let v = match result {
        Ok((a, g)) => json!({
            "state": "done",
            "window": total("window") + a.window + g.window,
            "afk": total("afk") + a.afk + g.afk,
            "gapWindow": total("gapWindow") + g.window,
            "until": a.until,
            "at": now_ms(),
        }),
        Err(e) => json!({"state": "error", "message": e}),
    };
    state.status.lock().unwrap().import = v.clone();
    v
}
