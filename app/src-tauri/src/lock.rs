//! A password in front of the journal or the whole window. The data itself is protected by the
//! database encryption (a key tied to the Windows account); this keeps out someone sitting at an
//! unlocked computer. The password is never stored: PBKDF2-HMAC-SHA256 with a random salt, kept
//! in the encrypted database under a key the page can't write (`kv_put` only takes `ui.*`).
//! Forgotten password: the recovery key from «Настройки → Данные» clears it.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::db;

const KEY: &str = "lock";
const ITERATIONS: u64 = 310_000;

/// Unlocked for this run of the app, until the window is hidden or the computer is locked.
static UNLOCKED: AtomicBool = AtomicBool::new(false);
static FAILS: AtomicU32 = AtomicU32::new(0);

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Lock {
    salt: String,
    hash: String,
    iterations: u64,
    pub journal: bool,
    pub app: bool,
}

fn load(conn: &Connection) -> Option<Lock> {
    db::kv_get(conn, KEY).and_then(|v| serde_json::from_value::<Lock>(v).ok()).filter(|l| !l.hash.is_empty())
}

fn derive(password: &str, salt: &str, iterations: u64) -> Result<String, String> {
    let salt = hex(salt)?;
    let mut out = [0u8; 32];
    #[cfg(windows)]
    {
        use windows::Win32::Security::Cryptography::{BCryptDeriveKeyPBKDF2, BCRYPT_HMAC_SHA256_ALG_HANDLE};
        unsafe { BCryptDeriveKeyPBKDF2(BCRYPT_HMAC_SHA256_ALG_HANDLE, Some(password.as_bytes()), Some(&salt), iterations, &mut out, 0) }
            .ok()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = (password, &salt, iterations);
        return Err("no PBKDF2 on this platform".into());
    }
    #[allow(unreachable_code)]
    Ok(out.iter().map(|b| format!("{b:02x}")).collect())
}

fn hex(s: &str) -> Result<Vec<u8>, String> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(s.get(i..i + 2).unwrap_or(""), 16).map_err(|e| e.to_string())).collect()
}

/// Same time whatever the first differing byte is.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn verify(lock: &Lock, password: &str) -> bool {
    derive(password, &lock.salt, lock.iterations).is_ok_and(|h| same(&h, &lock.hash))
}

pub fn status(conn: &Connection) -> Value {
    match load(conn) {
        Some(l) => json!({"set": true, "journal": l.journal, "app": l.app, "unlocked": UNLOCKED.load(Ordering::Relaxed)}),
        None => json!({"set": false, "journal": false, "app": false, "unlocked": true}),
    }
}

/// Wrong guesses get slower: 0.4 s more per miss, up to 4 s.
pub fn unlock(conn: &Connection, password: &str) -> bool {
    let Some(lock) = load(conn) else { return true };
    if verify(&lock, password) {
        FAILS.store(0, Ordering::Relaxed);
        UNLOCKED.store(true, Ordering::Relaxed);
        return true;
    }
    let n = FAILS.fetch_add(1, Ordering::Relaxed) + 1;
    std::thread::sleep(std::time::Duration::from_millis(400 * u64::from(n.min(10))));
    false
}

pub fn relock() {
    UNLOCKED.store(false, Ordering::Relaxed);
}

/// Allowed when there is no lock, or the window was unlocked.
pub fn open(conn: &Connection) -> bool {
    UNLOCKED.load(Ordering::Relaxed) || load(conn).is_none()
}

/// The journal is closed by its own switch and by the whole-app one.
pub fn journal_open(conn: &Connection) -> bool {
    UNLOCKED.load(Ordering::Relaxed) || load(conn).is_none_or(|l| !l.journal && !l.app)
}

/// Set, change or remove the password and switch what it guards. With a password already set,
/// `current` must match to change or remove it; switching what it guards is enough to have
/// unlocked the window. `password`: None keeps it, "" removes the lock.
pub fn set(conn: &Connection, current: Option<&str>, password: Option<&str>, journal: bool, app: bool) -> Result<Value, String> {
    let old = load(conn);
    if let Some(l) = &old {
        let needs = password.is_some() || !UNLOCKED.load(Ordering::Relaxed);
        if needs && !current.is_some_and(|c| verify(l, c)) {
            return Err(if current.is_some() { crate::i18n::tr("Неверный текущий пароль", "Wrong current password") } else { crate::i18n::tr("Нужен текущий пароль", "The current password is required") }.into());
        }
    }
    let next = match (password, old) {
        (Some(""), _) => None,
        (Some(p), _) => {
            if p.chars().count() < 4 {
                return Err(crate::i18n::tr("Пароль — хотя бы 4 символа", "The password needs at least 4 characters").into());
            }
            let salt = crate::secrets::random_hex(16)?;
            Some(Lock { hash: derive(p, &salt, ITERATIONS)?, salt, iterations: ITERATIONS, journal, app })
        }
        (None, Some(l)) => Some(Lock { journal, app, ..l }),
        (None, None) => return Err(crate::i18n::tr("Сначала задай пароль", "Set a password first").into()),
    };
    match next {
        Some(l) => db::kv_set(conn, KEY, &serde_json::to_value(l).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?,
        None => db::kv_set(conn, KEY, &Value::Null).map_err(|e| e.to_string())?,
    }
    UNLOCKED.store(true, Ordering::Relaxed);
    Ok(status(conn))
}

/// Forgotten password: the database recovery key proves it's the owner.
pub fn reset(conn: &Connection, recovery: &str) -> Result<Value, String> {
    let key = crate::secrets::get(crate::secrets::DB_KEY).ok_or(crate::i18n::tr("ключа базы нет", "no database key"))?;
    let given: String = recovery.chars().filter(|c| c.is_ascii_hexdigit()).collect::<String>().to_lowercase();
    if !same(&given, &key.to_lowercase()) {
        std::thread::sleep(std::time::Duration::from_secs(2));
        return Err(crate::i18n::tr("Это не ключ восстановления этой базы", "This is not the recovery key of this database").into());
    }
    db::kv_set(conn, KEY, &Value::Null).map_err(|e| e.to_string())?;
    UNLOCKED.store(true, Ordering::Relaxed);
    Ok(status(conn))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn set_unlock_change_remove() {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        assert!(set(&conn, None, None, true, false).is_err());
        assert!(set(&conn, None, Some("abc"), true, false).is_err());
        set(&conn, None, Some("секрет-1"), true, false).unwrap();
        relock();
        assert!(!journal_open(&conn));
        assert!(!unlock(&conn, "wrong"));
        assert!(unlock(&conn, "секрет-1"));
        assert!(journal_open(&conn));
        // changing needs the current password; switching only needs the window unlocked
        assert!(set(&conn, Some("nope"), Some("другой"), true, true).is_err());
        set(&conn, None, None, false, true).unwrap();
        relock();
        assert!(set(&conn, None, None, true, true).is_err());
        let l = load(&conn).unwrap();
        assert!(l.app && !l.journal);
        set(&conn, Some("секрет-1"), Some(""), false, false).unwrap();
        assert!(load(&conn).is_none());
        assert!(open(&conn));
    }
}
