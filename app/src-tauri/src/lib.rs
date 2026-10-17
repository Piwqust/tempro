mod agents;
mod ai;
mod api;
mod aw;
mod db;
mod guard;
mod i18n;
mod icons;
mod lock;
mod ocr;
mod secrets;
mod sensors;
mod server;
mod state;
mod timeutil;

use serde_json::Value;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

use state::{AppState, Msg, Status};

#[tauri::command]
async fn call(state: tauri::State<'_, Arc<AppState>>, name: String, args: Value) -> Result<Value, String> {
    let state = state.inner().clone();
    // SQLite, file scans and HTTP block; keep them off the async runtime
    tauri::async_runtime::spawn_blocking(move || api::call(&state, &name, args)).await.map_err(|e| e.to_string())?
}

/// Tray items, kept to relabel them when the language changes.
static TRAY: std::sync::OnceLock<(MenuItem<tauri::Wry>, MenuItem<tauri::Wry>, CheckMenuItem<tauri::Wry>, MenuItem<tauri::Wry>)> = std::sync::OnceLock::new();

pub fn relabel_tray() {
    if let Some((open, focus, pause, quit)) = TRAY.get() {
        let _ = open.set_text(i18n::tr("Открыть Tempro", "Open Tempro"));
        let _ = focus.set_text(i18n::tr("Сейчас работаю над…", "I'm working on…"));
        let _ = pause.set_text(i18n::tr("Пауза записи", "Pause recording"));
        let _ = quit.set_text(i18n::tr("Выйти", "Quit"));
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn register_hotkey(app: &AppHandle, hotkey: &str) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if !hotkey.trim().is_empty() {
        if let Err(e) = gs.register(hotkey.trim()) {
            eprintln!("hotkey {hotkey}: {e}");
        }
    }
}

/// The database is encrypted with a key kept in the Windows Credential Manager. An old
/// unencrypted database is converted on the first start; if anything about that fails, Tempro
/// keeps working on the plain file rather than lose data, and says so in the log.
fn unlock_database(path: &std::path::Path) {
    let key = match secrets::db_key() {
        Ok(k) => k,
        Err(e) => return eprintln!("database stays unencrypted: no key ({e})"),
    };
    if path.exists() && db::is_plaintext(path) {
        if let Err(e) = db::encrypt_file(path, &key) {
            return eprintln!("database stays unencrypted: {e}");
        }
    }
    db::use_key(key);
}

fn start_backend() -> Arc<AppState> {
    let path = db::db_path();
    unlock_database(&path);
    let write = db::open(&path).expect("open Tempro database");
    let read = db::open(&path).expect("open Tempro database");
    if db::meta_get(&write, "own_start").is_none() {
        let _ = db::meta_set(&write, "own_start", &timeutil::now_ms().to_string());
    }
    let settings = Arc::new(RwLock::new(db::load_settings(&write)));
    i18n::apply(&settings.read().unwrap());
    let (tx, rx) = mpsc::channel::<Msg>();
    let state = Arc::new(AppState {
        db_path: path,
        read: Mutex::new(read),
        tx: tx.clone(),
        settings: settings.clone(),
        status: Mutex::new(Status { sensors_since: timeutil::now_ms(), ..Default::default() }),
        idle_ms: Arc::new(AtomicU64::new(0)),
        paused: AtomicBool::new(false),
        app: OnceLock::new(),
    });
    state::spawn_writer(state.clone(), write, rx);

    // sensors and OCR speak their own message types; forward them into the writer queue
    let (stx, srx) = mpsc::channel();
    sensors::spawn(stx);
    let fwd = tx.clone();
    std::thread::spawn(move || {
        for s in srx {
            if fwd.send(Msg::Sensor(s)).is_err() {
                break;
            }
        }
    });
    let (otx, orx) = mpsc::channel();
    ocr::spawn(settings, state.idle_ms.clone(), otx);
    std::thread::spawn(move || {
        for o in orx {
            if tx.send(Msg::Ocr(o)).is_err() {
                break;
            }
        }
    });

    server::spawn(state.clone());
    // history at start, then every 10 min the stretches where only ActivityWatch was recording
    let st = state.clone();
    std::thread::spawn(move || loop {
        if st.settings().import_aw {
            state::run_import(&st);
        }
        std::thread::sleep(std::time::Duration::from_secs(600));
    });
    state
}

/// Debug builds only: `TEMPRO_SIDE=1` runs next to the installed Tempro (no single-instance,
/// no "running" marker, HTTP on `TEMPRO_PORT`), so the interface can be worked on without
/// stopping the real recording.
pub fn side_instance() -> bool {
    cfg!(debug_assertions) && std::env::var_os("TEMPRO_SIDE").is_some()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    guard::install_panic_hook();
    // the scheduled watchdog decides here and exits; it never becomes a second Tempro
    guard::watchdog_gate();
    let minimized = std::env::args().any(|a| a == "--minimized");
    let side = side_instance();

    let mut builder = tauri::Builder::default();
    if !side {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // a background start (autostart, watchdog) racing a running copy must not pop the window up
            if !args.iter().any(|a| a == "--minimized" || a == "--watchdog") {
                show_main(app)
            }
        }));
    }
    builder
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        show_main(app);
                        let _ = app.emit("focus-picker", ());
                    }
                })
                .build(),
        )
        .setup(move |app| {
            // started here, after single-instance had its chance to exit a second copy
            let state = start_backend();
            if !side {
                guard::mark_running();
            }
            app.manage(state.clone());
            let _ = state.app.set(app.handle().clone());
            if !cfg!(debug_assertions) {
                guard::spawn_watchdog_setup();
                // autostart points at whichever exe enabled it; an installed build takes it over,
                // and is switched on once on its first start
                use tauri_plugin_autostart::ManagerExt;
                let al = app.autolaunch();
                let first = db::meta_get(&state.read.lock().unwrap(), "autostart_set").is_none();
                if first || al.is_enabled().unwrap_or(false) {
                    let _ = al.enable();
                }
                if first {
                    let _ = db::meta_set(&state.read.lock().unwrap(), "autostart_set", "1");
                }
            }
            // background jobs live in the page; a hidden window's timers get throttled, an event still lands
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(600));
                let _ = handle.emit("tick", ());
            });
            register_hotkey(app.handle(), &state.settings().hotkey);
            if minimized {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }

            let open = MenuItem::with_id(app, "open", i18n::tr("Открыть Tempro", "Open Tempro"), true, None::<&str>)?;
            let focus = MenuItem::with_id(app, "focus", i18n::tr("Сейчас работаю над…", "I'm working on…"), true, None::<&str>)?;
            let pause = CheckMenuItem::with_id(app, "pause", i18n::tr("Пауза записи", "Pause recording"), true, false, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", i18n::tr("Выйти", "Quit"), true, None::<&str>)?;
            let _ = TRAY.set((open.clone(), focus.clone(), pause.clone(), quit.clone()));
            let menu = Menu::with_items(app, &[&open, &focus, &pause, &sep, &quit])?;
            let st = state.clone();
            let pause_item = pause.clone();
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().expect("bundle icon"))
                .tooltip("Tempro")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, e| match e.id.as_ref() {
                    "open" => show_main(app),
                    "focus" => {
                        show_main(app);
                        let _ = app.emit("focus-picker", ());
                    }
                    "pause" => {
                        let on = !st.paused.load(Ordering::Relaxed);
                        st.paused.store(on, Ordering::Relaxed);
                        let _ = pause_item.set_checked(on);
                    }
                    "quit" => {
                        guard::mark_stopped();
                        app.exit(0)
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // the tracker lives in the tray; closing the window must not stop it
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
                // a hidden window opens locked again
                lock::relock();
                let _ = window.emit("locked", ());
            }
        })
        .invoke_handler(tauri::generate_handler![call])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
