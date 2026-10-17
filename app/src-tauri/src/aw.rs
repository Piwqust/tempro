//! One-way import from ActivityWatch. Its database is opened read-only: AW may keep running.
//! History before Tempro's first event is taken whole; after that, only the stretches where
//! Tempro itself wasn't recording (app closed, crashed, not started) — so time is never doubled.

use rusqlite::{params, Connection, OpenFlags};
use std::path::{Path, PathBuf};

use crate::db;
use crate::timeutil::{parse_utc, to_aw_ts};

pub fn default_db_path() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA").unwrap_or_default();
    PathBuf::from(base).join(r"activitywatch\activitywatch\aw-server\peewee-sqlite.v2.db")
}

#[derive(Default, serde::Serialize)]
pub struct ImportResult {
    pub window: usize,
    pub afk: usize,
    pub until: f64,
}

/// Idempotent: remembers how far each bucket was imported and continues from there.
pub fn import(aw_path: &Path, dest: &Connection, own_start: f64) -> Result<ImportResult, String> {
    let aw = Connection::open_with_flags(aw_path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| format!("Не удалось открыть базу ActivityWatch ({}): {e}", aw_path.display()))?;
    let bucket = |kind: &str| -> Option<i64> { aw.query_row("SELECT key FROM bucketmodel WHERE type = ?1 ORDER BY key LIMIT 1", [kind], |r| r.get(0)).ok() };

    let mut res = ImportResult { until: own_start, ..Default::default() };
    for (kind, meta_key) in [("currentwindow", "aw_window_until"), ("afkstatus", "aw_afk_until")] {
        let Some(key) = bucket(kind) else { continue };
        let since = db::meta_get(dest, meta_key).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
        if since >= own_start {
            continue;
        }
        let mut st = aw
            .prepare("SELECT timestamp, duration, datastr FROM eventmodel WHERE bucket_id = ?1 AND timestamp > ?2 AND timestamp < ?3 ORDER BY timestamp")
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map(params![key, to_aw_ts(since), to_aw_ts(own_start)], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?, r.get::<_, String>(2)?)))
            .map_err(|e| e.to_string())?;

        let mut tx = dest.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut n = 0usize;
        let mut last = since;
        for row in rows {
            let (ts, dur, data) = row.map_err(|e| e.to_string())?;
            let Some(ts) = parse_utc(&ts) else { continue };
            // clip at our own start so the two sources never overlap
            let dur = dur.min((own_start - ts) / 1000.0).max(0.0);
            let v: serde_json::Value = serde_json::from_str(&data).unwrap_or_default();
            if kind == "currentwindow" {
                tx.execute(
                    "INSERT INTO raw_window (ts, dur, app, title, exe, source) VALUES (?1, ?2, ?3, ?4, '', 'aw')",
                    params![ts, dur, v["app"].as_str().unwrap_or("?"), v["title"].as_str().unwrap_or("")],
                )
            } else {
                let afk = v["status"].as_str() == Some("afk");
                tx.execute(
                    "INSERT INTO raw_afk (ts, dur, afk, kind, source) VALUES (?1, ?2, ?3, ?4, 'aw')",
                    params![ts, dur, afk as i64, if afk { "idle" } else { "input" }],
                )
            }
            .map_err(|e| e.to_string())?;
            n += 1;
            last = last.max(ts);
            // commit in chunks: the live writer shares the database and shouldn't wait long
            if n % 20_000 == 0 {
                db::meta_set(&tx, meta_key, &last.to_string()).map_err(|e| e.to_string())?;
                tx.commit().map_err(|e| e.to_string())?;
                tx = dest.unchecked_transaction().map_err(|e| e.to_string())?;
            }
        }
        db::meta_set(&tx, meta_key, &last.to_string()).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        if kind == "currentwindow" {
            res.window = n;
        } else {
            res.afk = n;
        }
    }
    Ok(res)
}

pub fn settings_path() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA").unwrap_or_default();
    PathBuf::from(base).join(r"activitywatch\activitywatch\aw-server\settings.json")
}

/// ActivityWatch categories (regex over app and title) for the "kind of activity" breakdown.
pub fn read_categories(path: &Path) -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    let out: Vec<serde_json::Value> = v["classes"]
        .as_array()?
        .iter()
        .filter(|c| c["rule"]["type"] == "regex" && c["rule"]["regex"].as_str().is_some_and(|r| !r.is_empty()))
        .map(|c| serde_json::json!({"name": c["name"], "regex": c["rule"]["regex"], "ignoreCase": c["rule"]["ignore_case"].as_bool().unwrap_or(false)}))
        .collect();
    Some(serde_json::Value::Array(out))
}

type Iv = (f64, f64);

/// Merged spans where Tempro's own presence stream was running.
fn own_coverage(dest: &Connection, from: f64) -> Result<Vec<Iv>, String> {
    let mut st = dest
        .prepare("SELECT ts, ts + dur * 1000 FROM raw_afk WHERE source = 'tempro' AND ts + dur * 1000 > ?1 ORDER BY ts")
        .map_err(|e| e.to_string())?;
    let rows = st.query_map([from], |r| Ok((r.get::<_, f64>(0)?, r.get::<_, f64>(1)?))).map_err(|e| e.to_string())?;
    let mut out: Vec<Iv> = Vec::new();
    for r in rows {
        let (a, b) = r.map_err(|e| e.to_string())?;
        // rows a few seconds apart are one running session
        match out.last_mut() {
            Some(last) if a <= last.1 + 15_000.0 => last.1 = last.1.max(b),
            _ => out.push((a, b)),
        }
    }
    Ok(out)
}

/// Parts of [a, b) not covered by `cov` (sorted, merged).
fn gaps(a: f64, b: f64, cov: &[Iv]) -> Vec<Iv> {
    let mut out = Vec::new();
    let mut t = a;
    for &(s, e) in cov {
        if e <= t {
            continue;
        }
        if s >= b {
            break;
        }
        if s > t {
            out.push((t, s.min(b)));
        }
        t = t.max(e);
        if t >= b {
            break;
        }
    }
    if t < b {
        out.push((t, b));
    }
    out
}

/// Fill the stretches after Tempro's first start where only ActivityWatch was recording.
/// Events still growing (AW extends the newest one) are left for the next run.
pub fn import_gaps(aw_path: &Path, dest: &Connection, own_start: f64, now: f64) -> Result<ImportResult, String> {
    let aw = Connection::open_with_flags(aw_path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| format!("Не удалось открыть базу ActivityWatch ({}): {e}", aw_path.display()))?;
    let bucket = |kind: &str| -> Option<i64> { aw.query_row("SELECT key FROM bucketmodel WHERE type = ?1 ORDER BY key LIMIT 1", [kind], |r| r.get(0)).ok() };
    let settled = now - 3.0 * 60_000.0;
    let mut res = ImportResult { until: settled, ..Default::default() };

    for (kind, meta_key) in [("currentwindow", "aw_gap_window"), ("afkstatus", "aw_gap_afk")] {
        let Some(key) = bucket(kind) else { continue };
        // the cursor is the start of the last event already handled
        let cursor = db::meta_get(dest, meta_key).and_then(|s| s.parse::<f64>().ok());
        let since = cursor.unwrap_or(own_start - 12.0 * 3_600_000.0);
        let cov = own_coverage(dest, since - 6.0 * 3_600_000.0)?;
        let mut st = aw
            .prepare("SELECT timestamp, duration, datastr FROM eventmodel WHERE bucket_id = ?1 AND timestamp >= ?2 ORDER BY timestamp")
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map(params![key, to_aw_ts(since)], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?, r.get::<_, String>(2)?)))
            .map_err(|e| e.to_string())?;

        let tx = dest.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut n = 0usize;
        let mut next = cursor;
        for row in rows {
            let (ts, dur, data) = row.map_err(|e| e.to_string())?;
            let Some(start) = parse_utc(&ts) else { continue };
            if cursor.is_some_and(|c| start <= c) {
                continue;
            }
            let end = start + dur * 1000.0;
            if end <= own_start {
                next = Some(start); // history import owns everything before Tempro's start
                continue;
            }
            if end > settled {
                break; // still growing: next run
            }
            next = Some(start);
            let v: serde_json::Value = serde_json::from_str(&data).unwrap_or_default();
            for (a, b) in gaps(start.max(own_start), end, &cov) {
                if b - a < 1000.0 {
                    continue;
                }
                if kind == "currentwindow" {
                    tx.execute(
                        "INSERT INTO raw_window (ts, dur, app, title, exe, source) VALUES (?1, ?2, ?3, ?4, '', 'aw')",
                        params![a, (b - a) / 1000.0, v["app"].as_str().unwrap_or("?"), v["title"].as_str().unwrap_or("")],
                    )
                } else {
                    let afk = v["status"].as_str() == Some("afk");
                    tx.execute(
                        "INSERT INTO raw_afk (ts, dur, afk, kind, source) VALUES (?1, ?2, ?3, ?4, 'aw')",
                        params![a, (b - a) / 1000.0, afk as i64, if afk { "idle" } else { "input" }],
                    )
                }
                .map_err(|e| e.to_string())?;
                n += 1;
            }
        }
        if let Some(next) = next {
            db::meta_set(&tx, meta_key, &next.to_string()).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        if kind == "currentwindow" {
            res.window = n;
        } else {
            res.afk = n;
        }
    }
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_aw(path: &Path) {
        let c = Connection::open(path).unwrap();
        c.execute_batch(
            "CREATE TABLE bucketmodel (key INTEGER PRIMARY KEY, id TEXT, type TEXT);
             CREATE TABLE eventmodel (id INTEGER PRIMARY KEY, bucket_id INTEGER, timestamp TEXT, duration REAL, datastr TEXT);
             INSERT INTO bucketmodel VALUES (1, 'w', 'currentwindow'), (2, 'a', 'afkstatus');
             INSERT INTO eventmodel (bucket_id, timestamp, duration, datastr) VALUES
               (1, '2026-10-16 10:00:00.000000+00:00', 60, '{\"app\":\"Figma.exe\",\"title\":\"x - Figma\"}'),
               (1, '2026-10-16 10:01:00.000000+00:00', 600, '{\"app\":\"msedge.exe\",\"title\":\"y\"}'),
               (2, '2026-10-16 10:00:00.000000+00:00', 900, '{\"status\":\"not-afk\"}');",
        )
        .unwrap();
    }

    #[test]
    fn gaps_are_the_uncovered_parts() {
        assert_eq!(gaps(0.0, 10.0, &[(2.0, 4.0), (6.0, 20.0)]), vec![(0.0, 2.0), (4.0, 6.0)]);
        assert_eq!(gaps(0.0, 10.0, &[]), vec![(0.0, 10.0)]);
        assert!(gaps(3.0, 5.0, &[(0.0, 10.0)]).is_empty());
    }

    #[test]
    fn gap_import_fills_only_where_tempro_was_off() {
        let dir = std::env::temp_dir().join(format!("tempro-gap-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let aw = dir.join("aw.db");
        let _ = std::fs::remove_file(&aw);
        fake_aw(&aw);
        let dest = db::open(&dir.join("t.db")).unwrap();
        dest.execute_batch("DELETE FROM raw_window; DELETE FROM raw_afk; DELETE FROM meta;").unwrap();
        let t = |s: &str| parse_utc(s).unwrap();
        // Tempro ran 10:02-10:05 only
        dest.execute("INSERT INTO raw_afk (ts, dur, afk, kind, source) VALUES (?1, 180, 0, 'input', 'tempro')", [t("2026-10-16 10:02:00+00:00")]).unwrap();
        let own = t("2026-10-16 09:00:00+00:00");
        let now = t("2026-10-16 12:00:00+00:00");
        let r = import_gaps(&aw, &dest, own, now).unwrap();
        let edge: Vec<(f64, f64)> = dest
            .prepare("SELECT ts, dur FROM raw_window WHERE app = 'msedge.exe' ORDER BY ts")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        // Edge 10:01-10:11 splits around Tempro's own 10:02-10:05
        assert_eq!(edge, vec![(t("2026-10-16 10:01:00+00:00"), 60.0), (t("2026-10-16 10:05:00+00:00"), 360.0)]);
        assert!(r.window >= 2);
        let again = import_gaps(&aw, &dest, own, now).unwrap();
        assert_eq!((again.window, again.afk), (0, 0), "second run adds nothing");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn import_is_idempotent_and_clipped() {
        let dir = std::env::temp_dir().join(format!("tempro-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let aw = dir.join("aw.db");
        let _ = std::fs::remove_file(&aw);
        fake_aw(&aw);
        let dest = db::open(&dir.join("t.db")).unwrap();
        dest.execute_batch("DELETE FROM raw_window; DELETE FROM raw_afk; DELETE FROM meta;").unwrap();

        let own = parse_utc("2026-10-16 10:05:00+00:00").unwrap();
        let r = import(&aw, &dest, own).unwrap();
        assert_eq!((r.window, r.afk), (2, 1));
        let again = import(&aw, &dest, own).unwrap();
        assert_eq!((again.window, again.afk), (0, 0));

        let dur: f64 = dest.query_row("SELECT dur FROM raw_window WHERE app = 'msedge.exe'", [], |r| r.get(0)).unwrap();
        assert_eq!(dur, 240.0, "clipped at Tempro's own start");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
