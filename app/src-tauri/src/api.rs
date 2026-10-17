//! One dispatcher behind the Tauri `call` command and the dev-only HTTP route,
//! so the UI talks to the same backend in the app window and in a browser.

use serde_json::{json, Value};
use std::sync::atomic::Ordering;

use crate::state::AppState;
use crate::timeutil::now_ms;
use crate::{agents, ai, db};

fn f(args: &Value, k: &str) -> Result<f64, String> {
    args[k].as_f64().ok_or_else(|| format!("нет аргумента {k}"))
}

fn s<'a>(args: &'a Value, k: &str) -> &'a str {
    args[k].as_str().unwrap_or("")
}

const KEY_MASK: &str = "••••••••";

/// Settings as the page sees them: the AI key is never sent back, only whether one is set.
fn public_settings(s: &db::Settings) -> Value {
    let mut v = serde_json::to_value(s).unwrap();
    v["aiKey"] = Value::String(if s.ai_key.is_empty() { String::new() } else { KEY_MASK.into() });
    v
}

pub fn call(state: &AppState, name: &str, args: Value) -> Result<Value, String> {
    let err = |e: rusqlite::Error| e.to_string();
    match name {
        "events" => {
            let (from, to) = (f(&args, "from")?, f(&args, "to")?);
            let ev = {
                let conn = state.read.lock().unwrap();
                db::read_events(&conn, from, to).map_err(err)?
            };
            let agent = agents::spans(&agents::root(), from, to);
            let mut v = serde_json::to_value(ev).map_err(|e| e.to_string())?;
            v["agent"] = serde_json::to_value(agent).map_err(|e| e.to_string())?;
            Ok(v)
        }
        "store_get" => Ok(db::kv_get(&state.read.lock().unwrap(), "store").unwrap_or(Value::Null)),
        "store_put" => {
            db::kv_set(&state.read.lock().unwrap(), "store", &args["value"]).map_err(err)?;
            Ok(Value::Null)
        }
        "settings_get" => Ok(public_settings(&state.settings())),
        "settings_put" => {
            let mut next: db::Settings = serde_json::from_value(args["value"].clone()).map_err(|e| e.to_string())?;
            // the page only ever sees a mask; the mask coming back means "unchanged"
            next.ai_key = next.ai_key.trim().to_string();
            if next.ai_key == KEY_MASK {
                next.ai_key = state.settings().ai_key;
            } else if !next.ai_key.is_ascii() || next.ai_key.chars().any(|c| c.is_ascii_control() || c == ' ') {
                // API keys are plain ASCII; anything else is a mangled mask or a paste gone wrong,
                // and saving it would silently replace a working key
                return Err("Ключ API может состоять только из латиницы, цифр и знаков без пробелов".into());
            } else if next.ai_key != state.settings().ai_key {
                crate::secrets::set(crate::secrets::AI_KEY, &next.ai_key)?;
            }
            db::save_settings(&state.read.lock().unwrap(), &next).map_err(err)?;
            let hotkey_changed = state.settings().hotkey != next.hotkey;
            *state.settings.write().unwrap() = next.clone();
            if hotkey_changed {
                if let Some(app) = state.app.get() {
                    crate::register_hotkey(app, &next.hotkey);
                }
            }
            Ok(public_settings(&next))
        }
        "compact_todo" => Ok(json!(db::compact_todo(&state.read.lock().unwrap(), f(&args, "before")?).map_err(err)?)),
        "compact" => {
            let pins: Vec<(f64, String, bool)> = serde_json::from_value(args["pins"].clone()).map_err(|e| e.to_string())?;
            let n = db::compact(&state.read.lock().unwrap(), f(&args, "before")?, f(&args, "until")?, &pins).map_err(err)?;
            Ok(json!(n))
        }
        // shown on request so the user can keep it in a password manager: without it, a copied
        // database (or one restored after reinstalling Windows) can't be opened
        "lock_status" => Ok(crate::lock::status(&state.read.lock().unwrap())),
        "lock_unlock" => Ok(Value::Bool(crate::lock::unlock(&state.read.lock().unwrap(), s(&args, "password")))),
        "lock_lock" => {
            crate::lock::relock();
            Ok(Value::Null)
        }
        "lock_set" => crate::lock::set(
            &state.read.lock().unwrap(),
            args["current"].as_str(),
            args["password"].as_str(),
            args["journal"].as_bool().unwrap_or(false),
            args["app"].as_bool().unwrap_or(false),
        ),
        "lock_reset" => crate::lock::reset(&state.read.lock().unwrap(), s(&args, "recovery")),
        "db_key" if !crate::lock::open(&state.read.lock().unwrap()) => Err("locked".into()),
        "db_key" => crate::secrets::get(crate::secrets::DB_KEY).map(Value::String).ok_or_else(|| "ключа нет".to_string()),
        "manual_add" => {
            let id = format!("m_{}", (now_ms() as u64).to_string() + &format!("{:04}", rand_suffix()));
            let start = f(&args, "start")?;
            let end = f(&args, "end")?;
            if end <= start {
                return Err("конец раньше начала".into());
            }
            state
                .read
                .lock()
                .unwrap()
                .execute(
                    r#"INSERT INTO manual (id, start, "end", kind, project_id, note, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
                    rusqlite::params![id, start, end, s(&args, "kind"), args["projectId"].as_str(), s(&args, "note"), now_ms()],
                )
                .map_err(err)?;
            Ok(json!({"id": id}))
        }
        "manual_end" => {
            state
                .read
                .lock()
                .unwrap()
                .execute(r#"UPDATE manual SET "end" = ?2 WHERE id = ?1"#, rusqlite::params![s(&args, "id"), f(&args, "end")?])
                .map_err(err)?;
            Ok(Value::Null)
        }
        "manual_remove" => {
            state.read.lock().unwrap().execute("DELETE FROM manual WHERE id = ?1", [s(&args, "id")]).map_err(err)?;
            Ok(Value::Null)
        }
        "journal" if !crate::lock::journal_open(&state.read.lock().unwrap()) => Err("locked".into()),
        "journal" => {
            let limit = args["limit"].as_i64().unwrap_or(200).clamp(1, 2000);
            Ok(Value::Array(db::journal(&state.read.lock().unwrap(), limit).map_err(err)?))
        }
        "status" => {
            let counts = db::counts(&state.read.lock().unwrap()).map_err(err)?;
            let st = state.status.lock().unwrap();
            let autostart = state.app.get().map(|a| {
                use tauri_plugin_autostart::ManagerExt;
                a.autolaunch().is_enabled().unwrap_or(false)
            });
            Ok(json!({
                "counts": counts,
                "extLastSeen": st.ext_last_seen,
                "extBrowser": st.ext_browser,
                "import": st.import,
                "sensorsSince": st.sensors_since,
                "lastSignal": st.last_signal,
                "paused": state.paused.load(Ordering::Relaxed),
                "autostart": autostart,
                "dbPath": state.db_path.display().to_string(),
                "encrypted": db::encrypted(),
                "watchdog": crate::guard::watchdog_status(),
                "crashes": crate::guard::recent_crashes(3),
                "crashLog": crate::guard::crash_log().display().to_string(),
                "awPath": crate::aw::default_db_path().display().to_string(),
                "agentsPath": agents::root().display().to_string(),
                "now": now_ms(),
            }))
        }
        "pause_set" => {
            state.paused.store(args["paused"].as_bool().unwrap_or(false), Ordering::Relaxed);
            Ok(Value::Null)
        }
        "autostart_set" => {
            use tauri_plugin_autostart::ManagerExt;
            let app = state.app.get().ok_or("приложение не готово")?;
            let r = if args["enabled"].as_bool().unwrap_or(false) { app.autolaunch().enable() } else { app.autolaunch().disable() };
            r.map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "import_aw" => Ok(crate::state::run_import(state)),
        "ai_suggest" => ai::suggest(&state.settings(), &args["items"], &args["projects"]),
        "ai_summary" => ai::summary(&state.settings(), &args["day"]),
        "ai_check" => ai::check(&state.settings()),
        "ai_titles" => ai::titles(&state.settings(), &args["sessions"]),
        "app_icons" => {
            // exe paths come from our own window rows; ActivityWatch history doesn't have them
            let conn = state.read.lock().unwrap();
            let mut st = conn
                .prepare_cached("SELECT exe FROM raw_window WHERE lower(app) = lower(?1) AND exe IS NOT NULL AND exe != '' ORDER BY id DESC LIMIT 1")
                .map_err(err)?;
            let mut out = serde_json::Map::new();
            for app in args["apps"].as_array().cloned().unwrap_or_default().iter().filter_map(|a| a.as_str()).take(80) {
                let exe: Option<String> = st.query_row([app], |r| r.get(0)).ok();
                let url = exe.and_then(|e| crate::icons::data_url(&e));
                out.insert(app.to_string(), url.map(Value::String).unwrap_or(Value::Null));
            }
            Ok(Value::Object(out))
        }
        "aw_categories" => Ok(db::kv_get(&state.read.lock().unwrap(), "aw_categories").unwrap_or(Value::Array(vec![]))),
        // small UI caches (AI titles, what was already asked); a prefix keeps them away from settings
        "kv_get" => {
            let key = s(&args, "key");
            if !key.starts_with("ui.") {
                return Err("ключ должен начинаться с ui.".into());
            }
            Ok(db::kv_get(&state.read.lock().unwrap(), key).unwrap_or(Value::Null))
        }
        "kv_put" => {
            let key = s(&args, "key");
            if !key.starts_with("ui.") {
                return Err("ключ должен начинаться с ui.".into());
            }
            db::kv_set(&state.read.lock().unwrap(), key, &args["value"]).map_err(err)?;
            Ok(Value::Null)
        }
        "export_csv" => {
            use tauri_plugin_dialog::DialogExt;
            let app = state.app.get().ok_or("приложение не готово")?;
            let Some(path) = app.dialog().file().add_filter("CSV", &["csv"]).set_file_name(s(&args, "name")).blocking_save_file() else {
                return Ok(json!({"saved": false}));
            };
            let path = path.into_path().map_err(|e| e.to_string())?;
            // BOM so Excel opens Cyrillic correctly
            std::fs::write(&path, format!("\u{feff}{}", s(&args, "content"))).map_err(|e| e.to_string())?;
            Ok(json!({"saved": true, "path": path.display().to_string()}))
        }
        "ocr_now" => {
            let (hwnd, app, _, _) = crate::sensors::foreground().ok_or("нет активного окна")?;
            let text = crate::ocr::recognize(hwnd).map_err(|e| e.to_string())?;
            Ok(json!({"app": app, "text": text.chars().take(600).collect::<String>()}))
        }
        _ => Err(format!("неизвестная команда {name}")),
    }
}

fn rand_suffix() -> u32 {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u64(now_ms() as u64);
    (h.finish() % 10_000) as u32
}
