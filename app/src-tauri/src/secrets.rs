//! Secrets in the Windows Credential Manager (generic credentials, protected by the user's
//! Windows login), never in Tempro's database: the database key and the AI key.

#[cfg(windows)]
mod imp {
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_FLAGS, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }

    pub fn get(name: &str) -> Option<String> {
        let target = wide(name);
        let mut out: *mut CREDENTIALW = std::ptr::null_mut();
        unsafe {
            CredReadW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None, &mut out).ok()?;
            let c = &*out;
            let blob = std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize).to_vec();
            CredFree(out as *const _);
            String::from_utf8(blob).ok()
        }
    }

    pub fn set(name: &str, value: &str) -> Result<(), String> {
        if value.is_empty() {
            return delete(name);
        }
        let mut target = wide(name);
        let mut user = wide("Tempro");
        let mut blob = value.as_bytes().to_vec();
        let cred = CREDENTIALW {
            Flags: CRED_FLAGS(0),
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(target.as_mut_ptr()),
            Comment: PWSTR::null(),
            LastWritten: FILETIME::default(),
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            // this machine and this Windows user only, no roaming
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            AttributeCount: 0,
            Attributes: std::ptr::null_mut(),
            TargetAlias: PWSTR::null(),
            UserName: PWSTR(user.as_mut_ptr()),
        };
        unsafe { CredWriteW(&cred, 0) }.map_err(|e| e.to_string())
    }

    pub fn delete(name: &str) -> Result<(), String> {
        let target = wide(name);
        match unsafe { CredDeleteW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None) } {
            Ok(()) => Ok(()),
            // not found is fine: nothing to delete
            Err(e) if e.code().0 as u32 == 0x8007_0490 => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn get(_: &str) -> Option<String> {
        None
    }
    pub fn set(_: &str, _: &str) -> Result<(), String> {
        Err("no credential store on this platform".into())
    }
    pub fn delete(_: &str) -> Result<(), String> {
        Ok(())
    }
}

pub use imp::{get, set};

pub const DB_KEY: &str = "Tempro/database";
pub const AI_KEY: &str = "Tempro/ai-key";

/// The database key, created on first use: 32 random bytes as hex.
pub fn db_key() -> Result<String, String> {
    if let Some(k) = get(DB_KEY).filter(|k| k.len() == 64) {
        return Ok(k);
    }
    let k = random_hex(32)?;
    set(DB_KEY, &k)?;
    // read back: a key we can't find again would lock the data away for good
    get(DB_KEY).filter(|r| *r == k).ok_or_else(|| "credential manager did not keep the key".to_string())
}

#[cfg(windows)]
pub fn random_hex(n: usize) -> Result<String, String> {
    use windows::Win32::Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG};
    let mut buf = vec![0u8; n];
    unsafe { BCryptGenRandom(None, &mut buf, BCRYPT_USE_SYSTEM_PREFERRED_RNG) }.ok().map_err(|e| e.to_string())?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

#[cfg(not(windows))]
pub fn random_hex(_: usize) -> Result<String, String> {
    Err("no secure random source".into())
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn round_trip() {
        // CI runners have no interactive logon session for Credential Manager
        if std::env::var_os("CI").is_some() {
            return;
        }
        let name = "Tempro/test-secret";
        super::set(name, "секрет 123").unwrap();
        assert_eq!(super::get(name).as_deref(), Some("секрет 123"));
        super::imp::delete(name).unwrap();
        assert_eq!(super::get(name), None);
        super::imp::delete(name).unwrap();
    }
}
