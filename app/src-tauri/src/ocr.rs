//! Text on screen for apps whose window title is always the same (Claude, ChatGPT, Orca).
//! Off by default. Runs only in "gaps" mode, only for the listed apps, only while you're active.
//! The screenshot lives in memory for the OCR call and is never written anywhere.

use std::sync::mpsc::Sender;
use std::sync::{Arc, RwLock};

use windows::core::Interface;
use windows::Graphics::Imaging::{BitmapBufferAccessMode, BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    DIB_RGB_COLORS,
};
use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
use windows::Win32::System::WinRT::{IMemoryBufferByteAccess, RoInitialize, RO_INIT_MULTITHREADED};
use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

use crate::db::Settings;

pub enum OcrSignal {
    Text { app: String, title: String, text: String },
}

pub fn spawn(settings: Arc<RwLock<Settings>>, idle_ms: Arc<std::sync::atomic::AtomicU64>, tx: Sender<OcrSignal>) {
    std::thread::Builder::new()
        .name("tempro-ocr".into())
        .spawn(move || {
            unsafe {
                let _ = RoInitialize(RO_INIT_MULTITHREADED);
            }
            let mut last: std::collections::HashMap<String, std::time::Instant> = Default::default();
            loop {
                std::thread::sleep(std::time::Duration::from_secs(30));
                let s = settings.read().unwrap().clone();
                if s.screenshots != "gaps" || idle_ms.load(std::sync::atomic::Ordering::Relaxed) > 60_000 {
                    continue;
                }
                let Some((hwnd, app, _, title)) = crate::sensors::foreground() else { continue };
                let key = app.to_lowercase();
                if !s.blind_apps.iter().any(|a| a.eq_ignore_ascii_case(&key)) || s.hide_apps.iter().any(|a| a.eq_ignore_ascii_case(&key)) {
                    continue;
                }
                if last.get(&key).is_some_and(|t| t.elapsed().as_secs() < s.ocr_minutes.max(1) * 60) {
                    continue;
                }
                last.insert(key, std::time::Instant::now());
                match recognize(hwnd) {
                    Ok(text) if !text.trim().is_empty() => {
                        let text: String = text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(2000).collect();
                        let _ = tx.send(OcrSignal::Text { app, title, text });
                    }
                    Ok(_) => {}
                    Err(e) => eprintln!("ocr: {e}"),
                }
            }
        })
        .expect("spawn ocr");
}

/// Capture one window and run the built-in Windows OCR on it.
pub fn recognize(hwnd: HWND) -> windows::core::Result<String> {
    let (mut w, mut h, mut px) = capture(hwnd)?;
    let max = OcrEngine::MaxImageDimension()? as i32;
    while w > max || h > max {
        (w, h, px) = half(w, h, &px);
    }
    let bmp = SoftwareBitmap::Create(BitmapPixelFormat::Bgra8, w, h)?;
    {
        let buffer = bmp.LockBuffer(BitmapBufferAccessMode::Write)?;
        let plane = buffer.GetPlaneDescription(0)?;
        let reference = buffer.CreateReference()?;
        let access: IMemoryBufferByteAccess = reference.cast()?;
        let mut data = std::ptr::null_mut();
        let mut cap = 0u32;
        unsafe { access.GetBuffer(&mut data, &mut cap)? };
        let dst = unsafe { std::slice::from_raw_parts_mut(data, cap as usize) };
        let row = (w * 4) as usize;
        for y in 0..h as usize {
            let d = plane.StartIndex as usize + y * plane.Stride as usize;
            dst[d..d + row].copy_from_slice(&px[y * row..(y + 1) * row]);
        }
    }
    let engine = OcrEngine::TryCreateFromUserProfileLanguages()?;
    let result = engine.RecognizeAsync(&bmp)?.join()?;
    Ok(result.Text()?.to_string())
}

fn capture(hwnd: HWND) -> windows::core::Result<(i32, i32, Vec<u8>)> {
    unsafe {
        let mut r = RECT::default();
        GetWindowRect(hwnd, &mut r)?;
        let (w, h) = (r.right - r.left, r.bottom - r.top);
        if w < 80 || h < 80 {
            return Err(windows::core::Error::from_hresult(windows::core::HRESULT(-1)));
        }
        let screen = GetDC(None);
        let dc = CreateCompatibleDC(Some(screen));
        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits = std::ptr::null_mut();
        let hbm = CreateDIBSection(Some(dc), &bmi, DIB_RGB_COLORS, &mut bits, None, 0)?;
        let old = SelectObject(dc, hbm.into());
        // PW_RENDERFULLCONTENT: needed for GPU-drawn windows (Chromium, Electron)
        let ok = PrintWindow(hwnd, dc, PRINT_WINDOW_FLAGS(2)).as_bool();
        let px = if ok { std::slice::from_raw_parts(bits as *const u8, (w * h * 4) as usize).to_vec() } else { Vec::new() };
        SelectObject(dc, old);
        let _ = DeleteObject(hbm.into());
        let _ = DeleteDC(dc);
        ReleaseDC(None, screen);
        if px.is_empty() {
            return Err(windows::core::Error::from_hresult(windows::core::HRESULT(-1)));
        }
        Ok((w, h, px))
    }
}

/// 2x box downscale, BGRA.
fn half(w: i32, h: i32, px: &[u8]) -> (i32, i32, Vec<u8>) {
    let (nw, nh) = (w / 2, h / 2);
    let mut out = vec![0u8; (nw * nh * 4) as usize];
    for y in 0..nh as usize {
        for x in 0..nw as usize {
            for c in 0..4 {
                let at = |xx: usize, yy: usize| px[(yy * w as usize + xx) * 4 + c] as u32;
                let v = (at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) / 4;
                out[(y * nw as usize + x) * 4 + c] = v as u8;
            }
        }
    }
    (nw, nh, out)
}
