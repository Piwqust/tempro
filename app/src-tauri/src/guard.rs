//! Keeping Tempro alive without anyone watching it: a crash log, a "running" marker, and a
//! Task Scheduler entry that starts Tempro again if it isn't running (every 5 min and at logon).
//! Quitting from the tray is respected: the watchdog leaves Tempro off until it's started again.

use std::io::Write;
use std::path::PathBuf;

use crate::db;

const TASK: &str = "Tempro\\Watchdog";
const MUTEX: &str = "Local\\TemproRunning";

fn stopped_flag() -> PathBuf {
    db::data_dir().join("stopped")
}

pub fn crash_log() -> PathBuf {
    db::data_dir().join("crash.log")
}

/// Panics anywhere are written down before the process goes (release builds abort on panic,
/// and the watchdog brings Tempro back).
pub fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let _ = std::fs::create_dir_all(db::data_dir());
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(crash_log()) {
            let when = crate::timeutil::now_ms();
            let thread = std::thread::current().name().unwrap_or("?").to_string();
            let _ = writeln!(f, "{} [{thread}] {info}", crate::timeutil::iso(when));
        }
        default(info);
    }));
}

/// The last lines of the crash log, newest last.
pub fn recent_crashes(n: usize) -> Vec<String> {
    std::fs::read_to_string(crash_log())
        .map(|s| s.lines().rev().take(n).map(String::from).collect::<Vec<_>>().into_iter().rev().collect())
        .unwrap_or_default()
}

/// Called first thing. With `--watchdog` (the scheduled task) this decides whether Tempro needs
/// starting at all, starts it detached if so, and exits: the task itself never runs the app.
pub fn watchdog_gate() {
    if !std::env::args().any(|a| a == "--watchdog") {
        // any normal start (by hand, at logon) means "record again"
        let _ = std::fs::remove_file(stopped_flag());
        return;
    }
    if !stopped_flag().exists() && !running() {
        if let Ok(exe) = std::env::current_exe() {
            let _ = std::process::Command::new(exe).arg("--minimized").spawn();
        }
    }
    std::process::exit(0);
}

/// Quit from the tray: the user wants it off, the watchdog must not undo that.
pub fn mark_stopped() {
    let _ = std::fs::create_dir_all(db::data_dir());
    let _ = std::fs::write(stopped_flag(), crate::timeutil::iso(crate::timeutil::now_ms()));
}

#[cfg(windows)]
mod win {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::Threading::{CreateMutexW, OpenMutexW, SYNCHRONIZATION_SYNCHRONIZE};

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }

    /// Held for the life of the process: its existence says "Tempro is running".
    pub fn hold(name: &str) {
        let n = wide(name);
        // the handle is never closed on purpose: Windows releases it when the process ends
        let _ = unsafe { CreateMutexW(None, false, PCWSTR(n.as_ptr())) };
    }

    pub fn exists(name: &str) -> bool {
        let n = wide(name);
        match unsafe { OpenMutexW(SYNCHRONIZATION_SYNCHRONIZE, false, PCWSTR(n.as_ptr())) } {
            Ok(h) => {
                let _ = unsafe { CloseHandle(HANDLE(h.0)) };
                true
            }
            Err(_) => false,
        }
    }
}

pub fn mark_running() {
    #[cfg(windows)]
    win::hold(MUTEX);
}

fn running() -> bool {
    #[cfg(windows)]
    return win::exists(MUTEX);
    #[cfg(not(windows))]
    false
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// The scheduled task, written as XML: the command-line defaults would skip it on battery.
fn task_xml(exe: &str, user: &str) -> String {
    // a start point in the past: the 5-minute repetition is already running when it's registered
    let start = "2026-01-01T00:00:00";
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Запускает Tempro снова, если он не работает. Выход из трея отключает это до следующего запуска.</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>{user}</UserId><Delay>PT1M</Delay></LogonTrigger>
    <TimeTrigger><Enabled>true</Enabled><StartBoundary>{start}</StartBoundary><Repetition><Interval>PT5M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition></TimeTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>{user}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <ExecutionTimeLimit>PT2M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author"><Exec><Command>{exe}</Command><Arguments>--watchdog</Arguments></Exec></Actions>
</Task>"#,
        exe = xml_escape(exe),
        user = xml_escape(user),
    )
}

/// Register (or refresh, if the exe moved) the watchdog task. Installed builds only: a dev build
/// lives in target/ and needs the Vite server, a watchdog would only start a blank window.
pub fn ensure_watchdog() -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Ok(());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?.display().to_string();
    let user = format!("{}\\{}", std::env::var("USERDOMAIN").unwrap_or_default(), std::env::var("USERNAME").unwrap_or_default());
    let xml = task_xml(&exe, &user);
    let path = std::env::temp_dir().join("tempro-watchdog.xml");
    // Task Scheduler reads UTF-16 with a byte order mark
    let mut bytes = vec![0xFF, 0xFE];
    for u in xml.encode_utf16() {
        bytes.extend_from_slice(&u.to_le_bytes());
    }
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    let out = quiet("schtasks").args(["/Create", "/F", "/TN", TASK, "/XML"]).arg(&path).output().map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&path);
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// A console program run without flashing a console window.
fn quiet(program: &str) -> std::process::Command {
    let mut c = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

static WATCHDOG: std::sync::Mutex<Option<Result<(), String>>> = std::sync::Mutex::new(None);

/// Register in the background at start; the result is kept for the settings screen.
pub fn spawn_watchdog_setup() {
    std::thread::spawn(|| {
        let r = ensure_watchdog();
        if let Err(e) = &r {
            eprintln!("watchdog task: {e}");
        }
        *WATCHDOG.lock().unwrap() = Some(r);
    });
}

/// null while registering (or in a dev build), true when the task is in place, an error otherwise
pub fn watchdog_status() -> serde_json::Value {
    if cfg!(debug_assertions) {
        return serde_json::json!({"state": "dev"});
    }
    match &*WATCHDOG.lock().unwrap() {
        None => serde_json::json!({"state": "pending"}),
        Some(Ok(())) => serde_json::json!({"state": "ok"}),
        Some(Err(e)) => serde_json::json!({"state": "error", "message": e}),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn task_xml_escapes_paths_and_keeps_battery_runs() {
        let x = super::task_xml(r"C:\Users\A&B\Tempro\tempro.exe", r"PC\user");
        assert!(x.contains(r"C:\Users\A&amp;B\Tempro\tempro.exe"));
        assert!(x.contains("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>"));
        assert!(x.contains("<Arguments>--watchdog</Arguments>"));
    }
}
