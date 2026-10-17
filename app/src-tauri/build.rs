fn main() {
    sqlcipher();
    tauri_build::build()
}

/// SQLCipher (an encrypting SQLite) with libtomcrypt as its crypto: plain C, nothing to install.
/// libsqlite3-sys (feature "sqlcipher") links against the `sqlcipher` library built here.
fn sqlcipher() {
    let dir = sqlcipher_src::source_dir();
    let inc = dir.join(sqlcipher_src::LIBTOMCRYPT_INCLUDE_DIR);

    let mut ltc = cc::Build::new();
    ltc.include(&inc).define("LTC_SOURCE", None).define("LTC_NO_TEST", None).warnings(false).opt_level(2);
    for s in sqlcipher_src::LIBTOMCRYPT_SOURCES {
        ltc.file(dir.join(s));
    }
    ltc.compile("tomcrypt");

    cc::Build::new()
        .file(dir.join(sqlcipher_src::SOURCE_FILE))
        .include(dir)
        .include(&inc)
        .define("SQLITE_HAS_CODEC", None)
        .define("SQLCIPHER_CRYPTO_LIBTOMCRYPT", None)
        // SQLCipher refuses to build with temp files on disk: they would hold plaintext
        .define("SQLITE_TEMP_STORE", "2")
        .define("SQLITE_EXTRA_INIT", "sqlcipher_extra_init")
        .define("SQLITE_EXTRA_SHUTDOWN", "sqlcipher_extra_shutdown")
        .define("SQLITE_THREADSAFE", "1")
        .define("SQLITE_ENABLE_API_ARMOR", None)
        .define("SQLITE_DQS", "0")
        .warnings(false)
        .opt_level(2)
        .compile("sqlcipher");
    // libtomcrypt seeds its generator from CryptGenRandom
    println!("cargo:rustc-link-lib=advapi32");
}
