//! Local HTTP on 127.0.0.1 only.
//! - POST /ext/tab: the browser extension reports the focused tab (origin must be an extension).
//! - POST /api/call/<name>: debug builds only, lets the UI run in a plain browser against the real backend.
//! No CORS headers are ever sent, so ordinary web pages can't read anything back.

use serde_json::Value;
use std::io::Read;
use std::sync::Arc;
use tiny_http::{Header, Method, Response, Server};

use crate::state::{AppState, Msg};

fn header(req: &tiny_http::Request, name: &'static str) -> Option<String> {
    req.headers().iter().find(|h| h.field.equiv(name)).map(|h| h.value.as_str().to_string())
}

fn json(status: u16, v: &Value) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(v.to_string())
        .with_status_code(status)
        .with_header(Header::from_bytes("content-type", "application/json").unwrap())
}

fn is_extension(origin: &str) -> bool {
    origin.starts_with("chrome-extension://") || origin.starts_with("moz-extension://") || origin.starts_with("extension://")
}

/// Keep what identifies the page; drop query strings that may carry tokens or personal data.
pub fn clean_url(url: &str) -> String {
    let (base, query) = url.split_once('?').unwrap_or((url, ""));
    let base = base.split('#').next().unwrap_or(base);
    // YouTube's video id is the page identity
    let keep: Vec<&str> = query.split('&').filter(|p| p.starts_with("v=") && base.contains("youtube.com/watch")).collect();
    if keep.is_empty() { base.to_string() } else { format!("{base}?{}", keep.join("&")) }
}

pub fn spawn(state: Arc<AppState>) {
    let port = match std::env::var("TEMPRO_PORT").ok().and_then(|p| p.parse().ok()) {
        Some(p) if crate::side_instance() => p,
        _ => state.settings().ext_port,
    };
    std::thread::Builder::new()
        .name("tempro-http".into())
        .spawn(move || {
            let server = match Server::http(("127.0.0.1", port)) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("http: port {port} busy: {e}");
                    return;
                }
            };
            for mut req in server.incoming_requests() {
                let origin = header(&req, "Origin").unwrap_or_default();
                let url = req.url().to_string();
                let mut body = String::new();
                let _ = req.as_reader().take(1 << 20).read_to_string(&mut body);
                let resp = route(&state, req.method(), &url, &origin, &body);
                let _ = req.respond(resp);
            }
        })
        .expect("spawn http");
}

fn route(state: &AppState, method: &Method, url: &str, origin: &str, body: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    match (method, url) {
        (Method::Get, "/health") => json(200, &serde_json::json!({"app": "tempro", "ok": true})),
        (Method::Post, "/ext/tab") => {
            if !is_extension(origin) {
                return json(403, &serde_json::json!({"error": "extensions only"}));
            }
            let Ok(v) = serde_json::from_str::<Value>(body) else { return json(400, &serde_json::json!({"error": "bad json"})) };
            let raw = v["url"].as_str().unwrap_or("");
            if raw.is_empty() || v["incognito"].as_bool() == Some(true) || !(raw.starts_with("http://") || raw.starts_with("https://")) {
                return json(200, &serde_json::json!({"ok": true, "stored": false}));
            }
            let _ = state.tx.send(Msg::Browser {
                url: clean_url(raw),
                title: v["title"].as_str().unwrap_or("").to_string(),
                browser: v["browser"].as_str().unwrap_or("browser").to_string(),
                playing: v["playing"].as_bool().unwrap_or(false),
                audible: v["audible"].as_bool().unwrap_or(false),
            });
            json(200, &serde_json::json!({"ok": true, "stored": true}))
        }
        (Method::Post, u) if cfg!(debug_assertions) && u.starts_with("/api/call/") => {
            // the Vite dev server proxies here; a page on any other origin is refused
            if !(origin.is_empty() || origin == "http://localhost:1420") {
                return json(403, &serde_json::json!({"error": "forbidden"}));
            }
            let name = &u["/api/call/".len()..];
            let args: Value = serde_json::from_str(body).unwrap_or(Value::Null);
            match crate::api::call(state, name, args) {
                Ok(v) => json(200, &v),
                Err(e) => json(500, &serde_json::json!({"error": e})),
            }
        }
        _ => json(404, &serde_json::json!({"error": "not found"})),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_lose_queries_but_youtube_keeps_the_video() {
        assert_eq!(clean_url("https://a.com/x?token=1#y"), "https://a.com/x");
        assert_eq!(clean_url("https://www.youtube.com/watch?v=abc&t=10"), "https://www.youtube.com/watch?v=abc");
        assert_eq!(clean_url("https://www.figma.com/design/KEY/Name?node-id=1"), "https://www.figma.com/design/KEY/Name");
    }

    #[test]
    fn only_extensions_may_report_tabs() {
        assert!(is_extension("chrome-extension://abcdef"));
        assert!(!is_extension("https://evil.example"));
        assert!(!is_extension(""));
    }
}
