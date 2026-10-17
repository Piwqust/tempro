//! The backend's half of the interface language: tray menu, error messages, the language the AI
//! answers in. Follows `Settings.lang` ("auto" | "ru" | "en"); "auto" reads Windows' own locale.

use std::sync::atomic::{AtomicBool, Ordering};

use crate::db::Settings;

static EN: AtomicBool = AtomicBool::new(false);

fn system_is_russian() -> bool {
    #[cfg(windows)]
    {
        if let Ok(k) = windows_registry::CURRENT_USER.open("Control Panel\\International") {
            if let Ok(name) = k.get_string("LocaleName") {
                return name.to_lowercase().starts_with("ru");
            }
        }
    }
    // unknown: Russian, the language the app was written in
    true
}

pub fn apply(s: &Settings) {
    let en = match s.lang.as_str() {
        "en" => true,
        "ru" => false,
        _ => !system_is_russian(),
    };
    EN.store(en, Ordering::Relaxed);
}

pub fn en() -> bool {
    EN.load(Ordering::Relaxed)
}

/// The string for the current language.
pub fn tr(ru: &'static str, en: &'static str) -> &'static str {
    if self::en() {
        en
    } else {
        ru
    }
}
