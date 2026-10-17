//! Small time helpers: avoids pulling chrono for a handful of conversions.

pub fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// `2026-10-16 13:20:43.640000+00:00` (ActivityWatch) or `2026-10-16T13:20:43.640Z` (ISO, UTC).
pub fn parse_utc(s: &str) -> Option<f64> {
    if s.len() < 19 {
        return None;
    }
    let n = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, m, d) = (n(0..4)?, n(5..7)?, n(8..10)?);
    let (hh, mm, ss) = (n(11..13)?, n(14..16)?, n(17..19)?);
    let frac = s
        .get(19..)
        .and_then(|t| t.strip_prefix('.'))
        .map(|t| t.chars().take_while(|c| c.is_ascii_digit()).collect::<String>())
        .and_then(|t| format!("0.{t}").parse::<f64>().ok())
        .unwrap_or(0.0);
    let days = days_from_civil(y, m, d);
    Some(((days * 86_400 + hh * 3600 + mm * 60 + ss) as f64 + frac) * 1000.0)
}

/// ActivityWatch text timestamp; text order equals time order, so it works in `WHERE`.
pub fn to_aw_ts(ms: f64) -> String {
    let secs = (ms / 1000.0).floor() as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}.000000+00:00", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// `2026-10-16T13:20:43Z`: for logs.
pub fn iso(ms: f64) -> String {
    let secs = (ms / 1000.0).floor() as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

// Howard Hinnant's civil date algorithms.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { yoe + era * 400 + 1 } else { yoe + era * 400 }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let ms = parse_utc("2026-10-16 13:20:43.640000+00:00").unwrap();
        assert_eq!(ms, 1_792_156_843_640.0);
        assert_eq!(parse_utc("2026-10-16T13:20:43.640Z"), Some(ms));
        assert_eq!(to_aw_ts(ms), "2026-10-16 13:20:43.000000+00:00");
        assert_eq!(parse_utc("1970-01-01 00:00:00+00:00"), Some(0.0));
        assert_eq!(parse_utc("garbage"), None);
    }
}
