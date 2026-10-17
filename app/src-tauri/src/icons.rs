//! Real program icons for the UI: taken from the exe, drawn at 32×32, encoded as a tiny PNG.
//! Our own window rows know the exe path; that's enough for everything the user actually runs.

use std::collections::HashMap;
use std::sync::Mutex;

use windows::core::PCWSTR;
use windows::Win32::Graphics::Gdi::{CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS};
use windows::Win32::UI::Shell::ExtractIconExW;
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, DrawIconEx, DI_NORMAL, HICON};

const SIZE: i32 = 32;

static CACHE: Mutex<Option<HashMap<String, Option<String>>>> = Mutex::new(None);

/// `data:image/png;base64,…` for an exe, cached per path.
pub fn data_url(exe: &str) -> Option<String> {
    let mut cache = CACHE.lock().unwrap();
    let cache = cache.get_or_insert_with(HashMap::new);
    if let Some(v) = cache.get(exe) {
        return v.clone();
    }
    let v = png_of(exe).map(|png| format!("data:image/png;base64,{}", base64(&png)));
    cache.insert(exe.to_string(), v.clone());
    v
}

fn png_of(exe: &str) -> Option<Vec<u8>> {
    let wide: Vec<u16> = exe.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let mut large = HICON::default();
        let n = ExtractIconExW(PCWSTR(wide.as_ptr()), 0, Some(&mut large), None, 1);
        if n == 0 || large.is_invalid() {
            return None;
        }
        let px = render(large);
        let _ = DestroyIcon(large);
        px.map(|rgba| encode_png(SIZE as u32, SIZE as u32, &rgba))
    }
}

unsafe fn render(icon: HICON) -> Option<Vec<u8>> {
    unsafe {
        let dc = CreateCompatibleDC(None);
        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: SIZE,
                biHeight: -SIZE,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits = std::ptr::null_mut();
        let hbm = CreateDIBSection(Some(dc), &bmi, DIB_RGB_COLORS, &mut bits, None, 0).ok()?;
        let old = SelectObject(dc, hbm.into());
        let ok = DrawIconEx(dc, 0, 0, icon, SIZE, SIZE, 0, None, DI_NORMAL).is_ok();
        let bgra = std::slice::from_raw_parts(bits as *const u8, (SIZE * SIZE * 4) as usize).to_vec();
        SelectObject(dc, old);
        let _ = DeleteObject(hbm.into());
        let _ = DeleteDC(dc);
        if !ok {
            return None;
        }
        Some(to_rgba(&bgra))
    }
}

/// GDI gives premultiplied BGRA; old icons have no alpha at all.
fn to_rgba(bgra: &[u8]) -> Vec<u8> {
    let has_alpha = bgra.chunks(4).any(|p| p[3] != 0);
    let mut out = Vec::with_capacity(bgra.len());
    for p in bgra.chunks(4) {
        let (b, g, r, a) = (p[0], p[1], p[2], p[3]);
        if !has_alpha {
            let a = if r | g | b == 0 { 0 } else { 255 };
            out.extend_from_slice(&[r, g, b, a]);
        } else if a == 0 {
            out.extend_from_slice(&[0, 0, 0, 0]);
        } else {
            let un = |c: u8| ((c as u32 * 255 + a as u32 / 2) / a as u32).min(255) as u8;
            out.extend_from_slice(&[un(r), un(g), un(b), a]);
        }
    }
    out
}

// ---------- minimal PNG: stored (uncompressed) deflate; a 32×32 icon is 4 KB either way ----------

fn crc32(data: &[u8]) -> u32 {
    let mut c = 0xffff_ffffu32;
    for &b in data {
        c ^= b as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 { 0xedb8_8320 ^ (c >> 1) } else { c >> 1 };
        }
    }
    !c
}

fn adler32(data: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for &x in data {
        a = (a + x as u32) % 65_521;
        b = (b + a) % 65_521;
    }
    (b << 16) | a
}

fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    let mut body = kind.to_vec();
    body.extend_from_slice(data);
    out.extend_from_slice(&body);
    out.extend_from_slice(&crc32(&body).to_be_bytes());
}

pub fn encode_png(w: u32, h: u32, rgba: &[u8]) -> Vec<u8> {
    let mut raw = Vec::with_capacity((w * 4 + 1) as usize * h as usize);
    for row in rgba.chunks((w * 4) as usize) {
        raw.push(0); // filter: none
        raw.extend_from_slice(row);
    }
    let mut z = vec![0x78, 0x01];
    let blocks: Vec<&[u8]> = raw.chunks(65_535).collect();
    for (i, blk) in blocks.iter().enumerate() {
        z.push((i == blocks.len() - 1) as u8);
        let len = blk.len() as u16;
        z.extend_from_slice(&len.to_le_bytes());
        z.extend_from_slice(&(!len).to_le_bytes());
        z.extend_from_slice(blk);
    }
    z.extend_from_slice(&adler32(&raw).to_be_bytes());

    let mut out = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&w.to_be_bytes());
    ihdr.extend_from_slice(&h.to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]); // 8-bit RGBA
    chunk(&mut out, b"IHDR", &ihdr);
    chunk(&mut out, b"IDAT", &z);
    chunk(&mut out, b"IEND", &[]);
    out
}

fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        s.push(T[(n >> 18) as usize & 63] as char);
        s.push(T[(n >> 12) as usize & 63] as char);
        s.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        s.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_has_valid_structure() {
        let png = encode_png(2, 2, &[255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0]);
        assert_eq!(&png[1..4], b"PNG");
        assert_eq!(&png[12..16], b"IHDR");
        assert_eq!(&png[png.len() - 8..png.len() - 4], b"IEND");
        assert_eq!(crc32(b"IEND"), 0xae42_6082);
    }

    #[test]
    fn base64_matches_reference() {
        assert_eq!(base64(b"Man"), "TWFu");
        assert_eq!(base64(b"Ma"), "TWE=");
        assert_eq!(base64(b"M"), "TQ==");
    }

    #[test]
    fn real_exe_icon() {
        // explorer.exe exists on every Windows box
        let url = data_url(r"C:\Windows\explorer.exe").expect("icon");
        assert!(url.starts_with("data:image/png;base64,iVBOR"));
    }
}
