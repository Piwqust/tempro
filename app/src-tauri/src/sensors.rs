//! Windows sensors on one thread with its own message loop:
//! foreground window by events (no 1 s polling), raw-input counters (never key codes),
//! lock/unlock, sleep/resume, audio sessions, microphone use, gamepad activity.

use std::cell::RefCell;
use std::sync::mpsc::Sender;

use windows::core::{w, Interface, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, AudioSessionStateActive, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::RemoteDesktop::{WTSRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION};
use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::Win32::UI::Input::XboxController::{XInputGetState, XINPUT_STATE};
use windows::Win32::UI::Input::{GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER, RIDEV_INPUTSINK, RID_INPUT};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, EnumChildWindows, GetForegroundWindow, GetMessageW, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, RegisterClassW, SetTimer, TranslateMessage, EVENT_OBJECT_NAMECHANGE, EVENT_SYSTEM_FOREGROUND, MSG,
    WINDOW_EX_STYLE, WINDOW_STYLE, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS, WNDCLASSW,
};

pub enum Signal {
    Window { app: String, exe: String, title: String },
    /// every 2 s
    Tick { idle_ms: u64, input: [u32; 4] },
    /// every 10 s: apps that make sound right now, apps that hold the microphone
    Media { audio: Vec<String>, mic: Vec<String> },
    Locked(bool),
    Sleeping(bool),
}

const WM_INPUT: u32 = 0x00FF;
const WM_TIMER: u32 = 0x0113;
const WM_WTSSESSION_CHANGE: u32 = 0x02B1;
const WM_POWERBROADCAST: u32 = 0x0218;

struct Ctx {
    tx: Sender<Signal>,
    // keys, clicks, wheel, moves since the last tick
    input: [u32; 4],
    ticks: u64,
    pad_packet: [u32; 4],
    pad_last: u32,
}

thread_local! {
    static CTX: RefCell<Option<Ctx>> = const { RefCell::new(None) };
}

fn send(sig: Signal) {
    CTX.with(|c| {
        if let Some(c) = c.borrow().as_ref() {
            let _ = c.tx.send(sig);
        }
    });
}

pub fn spawn(tx: Sender<Signal>) {
    std::thread::Builder::new()
        .name("tempro-sensors".into())
        .spawn(move || unsafe {
            if let Err(e) = run(tx) {
                eprintln!("sensors stopped: {e}");
            }
        })
        .expect("spawn sensors");
}

unsafe fn run(tx: Sender<Signal>) -> windows::core::Result<()> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        CTX.with(|c| *c.borrow_mut() = Some(Ctx { tx, input: [0; 4], ticks: 0, pad_packet: [0; 4], pad_last: GetTickCount() }));

        let hinst = GetModuleHandleW(None)?;
        let class = w!("TemproSensors");
        let wc = WNDCLASSW { lpfnWndProc: Some(wndproc), hInstance: hinst.into(), lpszClassName: class, ..Default::default() };
        RegisterClassW(&wc);
        // a real (hidden) top-level window: message-only windows don't get power broadcasts
        let hwnd = CreateWindowExW(WINDOW_EX_STYLE(0), class, w!("Tempro sensors"), WINDOW_STYLE(0), 0, 0, 0, 0, None, None, Some(hinst.into()), None)?;

        let _ = WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION);
        let devices = [
            RAWINPUTDEVICE { usUsagePage: 0x01, usUsage: 0x06, dwFlags: RIDEV_INPUTSINK, hwndTarget: hwnd }, // keyboard
            RAWINPUTDEVICE { usUsagePage: 0x01, usUsage: 0x02, dwFlags: RIDEV_INPUTSINK, hwndTarget: hwnd }, // mouse
        ];
        let _ = RegisterRawInputDevices(&devices, std::mem::size_of::<RAWINPUTDEVICE>() as u32);

        let flags = WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS;
        let _h1 = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, None, Some(win_event), 0, 0, flags);
        let _h2 = SetWinEventHook(EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_NAMECHANGE, None, Some(win_event), 0, 0, flags);
        SetTimer(Some(hwnd), 1, 2000, None);

        report_foreground();
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    Ok(())
}

unsafe extern "system" fn win_event(_: HWINEVENTHOOK, event: u32, hwnd: HWND, id_object: i32, id_child: i32, _: u32, _: u32) {
    // name changes fire for every object on screen; only the foreground window's own title matters
    if event == EVENT_OBJECT_NAMECHANGE && (id_object != 0 || id_child != 0 || hwnd != unsafe { GetForegroundWindow() }) {
        return;
    }
    unsafe { report_foreground() };
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_INPUT => {
                count_input(lparam);
                LRESULT(0)
            }
            WM_TIMER => {
                tick();
                LRESULT(0)
            }
            WM_WTSSESSION_CHANGE => {
                match wparam.0 {
                    7 => send(Signal::Locked(true)),  // WTS_SESSION_LOCK
                    8 => send(Signal::Locked(false)), // WTS_SESSION_UNLOCK
                    _ => {}
                }
                LRESULT(0)
            }
            WM_POWERBROADCAST => {
                match wparam.0 {
                    4 => send(Signal::Sleeping(true)),        // PBT_APMSUSPEND
                    7 | 18 => send(Signal::Sleeping(false)), // PBT_APMRESUMESUSPEND / PBT_APMRESUMEAUTOMATIC
                    _ => {}
                }
                LRESULT(1)
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }
}

/// Counts presses, clicks, wheel turns and moves. The key code is never read.
unsafe fn count_input(lparam: LPARAM) {
    let mut raw = RAWINPUT::default();
    let mut size = std::mem::size_of::<RAWINPUT>() as u32;
    let got = unsafe {
        GetRawInputData(
            HRAWINPUT(lparam.0 as *mut _),
            RID_INPUT,
            Some(&mut raw as *mut _ as *mut _),
            &mut size,
            std::mem::size_of::<RAWINPUTHEADER>() as u32,
        )
    };
    if got == u32::MAX {
        return;
    }
    CTX.with(|c| {
        let mut c = c.borrow_mut();
        let Some(c) = c.as_mut() else { return };
        unsafe {
            match raw.header.dwType {
                1 => {
                    // RI_KEY_BREAK = key up; count downs only
                    if raw.data.keyboard.Flags & 1 == 0 {
                        c.input[0] += 1;
                    }
                }
                0 => {
                    let m = raw.data.mouse;
                    let buttons = m.Anonymous.Anonymous.usButtonFlags;
                    if buttons & (0x0001 | 0x0004 | 0x0010) != 0 {
                        c.input[1] += 1;
                    }
                    if buttons & (0x0400 | 0x0800) != 0 {
                        c.input[2] += 1;
                    }
                    if m.lLastX != 0 || m.lLastY != 0 {
                        c.input[3] += 1;
                    }
                }
                _ => {}
            }
        }
    });
}

unsafe fn tick() {
    unsafe { report_foreground() };
    let now = unsafe { GetTickCount() };
    let mut lii = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    let last = if unsafe { GetLastInputInfo(&mut lii) }.as_bool() { lii.dwTime } else { now };

    let (input, ticks, pad_last) = CTX.with(|c| {
        let mut c = c.borrow_mut();
        let c = c.as_mut().unwrap();
        // gamepads don't move GetLastInputInfo; a changed packet number means the stick or a button moved
        for i in 0..4u32 {
            let mut st = XINPUT_STATE::default();
            if unsafe { XInputGetState(i, &mut st) } == 0 && st.dwPacketNumber != c.pad_packet[i as usize] {
                if c.pad_packet[i as usize] != 0 {
                    c.pad_last = now;
                }
                c.pad_packet[i as usize] = st.dwPacketNumber;
            }
        }
        c.ticks += 1;
        (std::mem::take(&mut c.input), c.ticks, c.pad_last)
    });
    let idle_ms = now.wrapping_sub(last).min(now.wrapping_sub(pad_last)) as u64;
    send(Signal::Tick { idle_ms, input });

    if ticks % 5 == 1 {
        send(Signal::Media { audio: audio_apps().unwrap_or_default(), mic: mic_apps() });
    }
}

pub fn foreground() -> Option<(HWND, String, String, String)> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return None;
        }
        let title = window_text(hwnd);
        let mut exe = process_path(window_pid(hwnd)).unwrap_or_default();
        // UWP apps are hosted by ApplicationFrameHost; the real app is a child window's process
        if exe.to_lowercase().ends_with("applicationframehost.exe") {
            if let Some(child) = uwp_child(hwnd) {
                exe = child;
            }
        }
        let app = exe.rsplit(['\\', '/']).next().unwrap_or("").to_string();
        Some((hwnd, if app.is_empty() { "unknown".into() } else { app }, exe, title))
    }
}

unsafe fn report_foreground() {
    if let Some((_, app, exe, title)) = foreground() {
        send(Signal::Window { app, exe, title });
    }
}

unsafe fn window_text(hwnd: HWND) -> String {
    unsafe {
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return String::new();
        }
        let mut buf = vec![0u16; len as usize + 1];
        let n = GetWindowTextW(hwnd, &mut buf);
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }
}

unsafe fn window_pid(hwnd: HWND) -> u32 {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    pid
}

pub fn process_path(pid: u32) -> Option<String> {
    if pid == 0 {
        return None;
    }
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut size = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut size).is_ok();
        let _ = CloseHandle(h);
        ok.then(|| String::from_utf16_lossy(&buf[..size as usize]))
    }
}

unsafe fn uwp_child(hwnd: HWND) -> Option<String> {
    struct Find {
        host: u32,
        found: Option<String>,
    }
    unsafe extern "system" fn cb(child: HWND, lp: LPARAM) -> windows::core::BOOL {
        let f = unsafe { &mut *(lp.0 as *mut Find) };
        let pid = unsafe { window_pid(child) };
        if pid != f.host {
            f.found = process_path(pid);
            return false.into();
        }
        true.into()
    }
    let mut f = Find { host: unsafe { window_pid(hwnd) }, found: None };
    unsafe {
        let _ = EnumChildWindows(Some(hwnd), Some(cb), LPARAM(&mut f as *mut Find as isize));
    }
    f.found
}

fn exe_name(pid: u32) -> Option<String> {
    process_path(pid).map(|p| p.rsplit(['\\', '/']).next().unwrap_or("").to_string())
}

/// Apps whose audio session is active and actually above silence.
fn audio_apps() -> windows::core::Result<Vec<String>> {
    unsafe {
        let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let dev = en.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
        let mgr: IAudioSessionManager2 = dev.Activate(CLSCTX_ALL, None)?;
        let sessions = mgr.GetSessionEnumerator()?;
        let mut out = Vec::new();
        for i in 0..sessions.GetCount()? {
            let Ok(ctl) = sessions.GetSession(i) else { continue };
            let Ok(ctl2) = ctl.cast::<IAudioSessionControl2>() else { continue };
            if ctl2.GetState().ok() != Some(AudioSessionStateActive) {
                continue;
            }
            let loud = ctl.cast::<IAudioMeterInformation>().ok().and_then(|m| m.GetPeakValue().ok()).unwrap_or(0.0);
            if loud < 0.001 {
                continue;
            }
            let Ok(pid) = ctl2.GetProcessId() else { continue };
            if let Some(name) = exe_name(pid) {
                if !name.is_empty() && !out.contains(&name) {
                    out.push(name);
                }
            }
        }
        Ok(out)
    }
}

/// Windows records microphone use per app; a start without a stop means "in use now".
fn mic_apps() -> Vec<String> {
    const BASE: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";
    let mut out = Vec::new();
    let Ok(root) = windows_registry::CURRENT_USER.open(BASE) else { return out };
    let mut check = |key: &windows_registry::Key, name: &str| {
        let start = key.get_u64("LastUsedTimeStart").unwrap_or(0);
        let stop = key.get_u64("LastUsedTimeStop").unwrap_or(1);
        if start != 0 && stop == 0 {
            // NonPackaged entries are exe paths with '#' for '\'
            let app = name.rsplit('#').next().unwrap_or(name).to_string();
            if !out.contains(&app) {
                out.push(app);
            }
        }
    };
    if let Ok(keys) = root.keys() {
        for name in keys {
            if name == "NonPackaged" {
                continue;
            }
            if let Ok(k) = root.open(&name) {
                check(&k, &name);
            }
        }
    }
    if let Ok(np) = root.open("NonPackaged") {
        if let Ok(keys) = np.keys() {
            for name in keys {
                if let Ok(k) = np.open(&name) {
                    check(&k, &name);
                }
            }
        }
    }
    out
}
