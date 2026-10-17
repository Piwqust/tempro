//! Optional model help: suggest projects for unassigned titles, write a day summary.
//! Local Ollama, or Claude through Anthropic's API or any proxy that relays it (Anthropic or OpenAI format).
//! Only what the caller passes is sent: titles and hours, never screenshots or input counts.

use serde_json::{json, Value};

use crate::db::Settings;

// Haiku: cheap and fast enough to look at every unassigned title and name every session
const CLAUDE_MODEL: &str = "claude-haiku-5-5";
const OLLAMA_MODEL: &str = "qwen2.5:7b";

fn ask(s: &Settings, system: &str, user: &str, schema: Value) -> Result<Value, String> {
    match s.ai_provider.as_str() {
        "claude" => claude(s, system, user, schema),
        "ollama" => ollama(s, system, user, schema),
        _ => Err(crate::i18n::tr("ИИ выключен. Включи Ollama или Claude в настройках.", "AI is off. Turn on Ollama or Claude in Settings.").into()),
    }
}

const ANTHROPIC: &str = "https://api.anthropic.com/v1";

/// Which wire format a base URL answered to last time: proxies speak Anthropic, OpenAI, or both.
static FORMAT: std::sync::Mutex<Option<(String, &'static str)>> = std::sync::Mutex::new(None);

fn base(s: &Settings) -> String {
    let b = s.ai_base_url.trim().trim_end_matches('/');
    if b.is_empty() { ANTHROPIC.to_string() } else { b.to_string() }
}

/// Models sometimes wrap JSON in ```json fences or a sentence; take the outermost object.
fn json_in(text: &str) -> Result<Value, String> {
    if let Ok(v) = serde_json::from_str(text.trim()) {
        return Ok(v);
    }
    let (a, b) = (text.find('{'), text.rfind('}'));
    match (a, b) {
        (Some(a), Some(b)) if b > a => serde_json::from_str(&text[a..=b]).map_err(|e| format!("{}: {e}", crate::i18n::tr("Ответ не JSON", "Not JSON"))),
        _ => Err(crate::i18n::tr("Ответ не JSON", "Not JSON").into()),
    }
}

fn post(url: &str, key: &str, body: &Value, extra: &[(&str, &str)]) -> Result<(u16, Value), String> {
    let mut req = ureq::post(url)
        .header("x-api-key", key)
        // many proxies authenticate with a bearer token instead of x-api-key
        .header("authorization", &format!("Bearer {key}"))
        .header("content-type", "application/json");
    for (k, v) in extra {
        req = req.header(*k, *v);
    }
    let mut resp = req
        .config()
        .http_status_as_error(false)
        .timeout_global(Some(std::time::Duration::from_secs(180)))
        .build()
        .send_json(body)
        .map_err(|e| format!("{} ({url}): {e}", crate::i18n::tr("API недоступен", "API unreachable")))?;
    let status = resp.status().as_u16();
    let text = resp.body_mut().read_to_string().map_err(|e| e.to_string())?;
    let v = serde_json::from_str(&text).unwrap_or_else(|_| json!({"raw": text.chars().take(300).collect::<String>()}));
    Ok((status, v))
}

fn err_text(v: &Value) -> String {
    v["error"]["message"].as_str().or(v["error"].as_str()).or(v["message"].as_str()).or(v["raw"].as_str()).unwrap_or("").to_string()
}

fn claude(s: &Settings, system: &str, user: &str, schema: Value) -> Result<Value, String> {
    let key = s.ai_key.trim();
    if key.is_empty() {
        return Err(crate::i18n::tr("Нет ключа API в настройках.", "No API key in Settings.").into());
    }
    let model = if s.ai_model.trim().is_empty() { CLAUDE_MODEL } else { s.ai_model.trim() };
    let base = base(s);
    let known = FORMAT.lock().unwrap().as_ref().filter(|(b, _)| *b == base).map(|(_, f)| *f);

    let mut errors = Vec::new();
    for format in ["anthropic", "openai"] {
        if known.is_some_and(|k| k != format) {
            continue;
        }
        let r = if format == "anthropic" { anthropic(&base, key, model, system, user, &schema) } else { openai(&base, key, model, system, user, &schema) };
        match r {
            Ok(v) => {
                *FORMAT.lock().unwrap() = Some((base.clone(), format));
                return Ok(v);
            }
            // the endpoint exists and answered: its error is the real one
            Err((true, e)) => return Err(e),
            Err((false, e)) => errors.push(e),
        }
    }
    Err(errors.join(" · "))
}

/// Err((final, message)): `final` = the endpoint understood us, don't try the other format.
fn anthropic(base: &str, key: &str, model: &str, system: &str, user: &str, schema: &Value) -> Result<Value, (bool, String)> {
    let mut body = json!({
        "model": model,
        "max_tokens": 16000,
        "system": system,
        "messages": [{"role": "user", "content": user}],
        // classification and naming are routine work: low effort is plenty
        "output_config": {"effort": "low", "format": {"type": "json_schema", "schema": schema}},
    });
    // Haiku has no server-side fallback; the larger models re-run a declined request on one
    let fallback = !model.starts_with("claude-haiku") && base == ANTHROPIC;
    let mut extra = vec![("anthropic-version", "2023-06-01")];
    if fallback {
        body["fallbacks"] = json!("default");
        extra.push(("anthropic-beta", "server-side-fallback-2026-07-01"));
    }
    let url = format!("{base}/messages");
    let (mut status, mut v) = post(&url, key, &body, &extra).map_err(|e| (false, e))?;
    // a proxy that doesn't know structured outputs: ask for JSON in words instead
    if status == 400 && err_text(&v).contains("output_config") {
        body.as_object_mut().unwrap().remove("output_config");
        body["system"] = json!(format!("{system}\n\nОтветь только JSON по схеме, без пояснений: {schema}"));
        (status, v) = post(&url, key, &body, &extra).map_err(|e| (false, e))?;
    }
    if status == 404 || status == 405 || (status == 200 && v.get("content").is_none()) {
        return Err((false, format!("{url}: {status}")));
    }
    if status != 200 {
        return Err((true, format!("API {status}: {}", err_text(&v))));
    }
    match v["stop_reason"].as_str() {
        Some("max_tokens") => return Err((true, crate::i18n::tr("Ответ модели обрезан: слишком много строк за раз.", "The model's answer was cut off: too many rows at once.").into())),
        Some("refusal") => return Err((true, crate::i18n::tr("Модель отказалась отвечать на этот запрос.", "The model declined to answer this request.").into())),
        _ => {}
    }
    let text = v["content"]
        .as_array()
        .and_then(|c| c.iter().find(|b| b["type"] == "text"))
        .and_then(|b| b["text"].as_str())
        .ok_or((true, crate::i18n::tr("Пустой ответ модели", "Empty answer from the model").to_string()))?;
    json_in(text).map_err(|e| (true, e))
}

/// OpenAI-compatible proxies (`/chat/completions`) that relay Claude models.
fn openai(base: &str, key: &str, model: &str, system: &str, user: &str, schema: &Value) -> Result<Value, (bool, String)> {
    let url = format!("{base}/chat/completions");
    let mut body = json!({
        "model": model,
        "max_tokens": 16000,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "response_format": {"type": "json_schema", "json_schema": {"name": "answer", "schema": schema, "strict": true}},
    });
    let (mut status, mut v) = post(&url, key, &body, &[]).map_err(|e| (false, e))?;
    if status == 400 && err_text(&v).contains("response_format") {
        body.as_object_mut().unwrap().remove("response_format");
        body["messages"][0]["content"] = json!(format!("{system}\n\nОтветь только JSON по схеме, без пояснений: {schema}"));
        (status, v) = post(&url, key, &body, &[]).map_err(|e| (false, e))?;
    }
    if status == 404 || status == 405 {
        return Err((false, format!("{url}: {status}")));
    }
    if status != 200 {
        return Err((true, format!("API {status}: {}", err_text(&v))));
    }
    let text = v["choices"][0]["message"]["content"].as_str().ok_or((true, crate::i18n::tr("Пустой ответ модели", "Empty answer from the model").to_string()))?;
    json_in(text).map_err(|e| (true, e))
}

/// A tiny round trip for the Settings "check" button.
pub fn check(s: &Settings) -> Result<Value, String> {
    let started = std::time::Instant::now();
    let schema = json!({"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"], "additionalProperties": false});
    let v = ask(s, "Ты проверка связи.", "Ответь {\"ok\": true}", schema)?;
    let format = FORMAT.lock().unwrap().as_ref().map(|(_, f)| *f).unwrap_or(if s.ai_provider == "ollama" { "ollama" } else { "?" });
    Ok(json!({"ok": v["ok"].as_bool().unwrap_or(false), "ms": started.elapsed().as_millis() as u64, "format": format}))
}

fn ollama(s: &Settings, system: &str, user: &str, schema: Value) -> Result<Value, String> {
    let model = if s.ai_model.trim().is_empty() { OLLAMA_MODEL } else { s.ai_model.trim() };
    let body = json!({
        "model": model,
        "stream": false,
        "format": schema,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    });
    let url = format!("{}/api/chat", s.ollama_url.trim_end_matches('/'));
    let mut resp = ureq::post(&url).send_json(&body).map_err(|e| format!("{} ({url}): {e}", crate::i18n::tr("Ollama не отвечает", "Ollama is not responding")))?;
    let v: Value = resp.body_mut().read_json().map_err(|e| e.to_string())?;
    let text = v["message"]["content"].as_str().ok_or(crate::i18n::tr("Пустой ответ Ollama", "Empty answer from Ollama"))?;
    serde_json::from_str(text).map_err(|e| format!("{}: {e}", crate::i18n::tr("Ответ не JSON", "Not JSON")))
}

/// `items`: [{id, app, title, minutes}], `projects`: [{id, name, hints}]
/// → [{id, projectId|null, newProject|null, confidence, reason}]
pub fn suggest(s: &Settings, items: &Value, projects: &Value) -> Result<Value, String> {
    let system = "Ты разносишь время по проектам в трекере. Пользователь — дизайнер, моушн-дизайнер и разработчик (Figma, After Effects, Claude Code, Cursor).         Дан список проектов (вид проекта: работа, досуг, личное, служебное; ключевые слова) и окна: программа, вид окна (папка Claude Code, папка редактора, файл Figma, файл Adobe, вкладка браузера, чат, окно), заголовок или имя, минуты.
        Для каждого окна:
        - projectId: проект из списка, если заголовок на него указывает (имя клиента, файла, сайта, папки, чата) или окно явно подходит под проект-тему         (развлекательное видео → проект досуга про видео, игра → про игры, покупки и дела → личное, настройки системы → служебное).
        - Pinterest, Behance, Dribbble, Savee, сайты шрифтов, референсов, видео про дизайн, моушн, разработку и ИИ — работа, а не досуг.
        - Общие окна без смысла («Media viewer», «Новая вкладка», «Claude», «ChatGPT») — null.
        - newProject: папка Claude Code или редактора, файл Figma или Adobe с понятным собственным именем — почти всегда отдельный рабочий проект.         Если его нет в списке, верни newProject с этим именем (как есть, без «папка»), confidence 0.85. Для вкладок, чатов и общих окон — null. Одинаковым проектам давай одинаковое имя.
        Не угадывай: confidence ниже 0.8, если есть сомнения.";
    let user = json!({"projects": projects, "windows": items}).to_string();
    let schema = json!({
        "type": "object",
        "properties": {"suggestions": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "projectId": {"type": ["string", "null"]},
                "newProject": {"type": ["string", "null"]},
                "confidence": {"type": "number"},
                "reason": {"type": "string"}
            },
            "required": ["id", "projectId", "newProject", "confidence", "reason"],
            "additionalProperties": false
        }}},
        "required": ["suggestions"],
        "additionalProperties": false
    });
    Ok(ask(s, system, &user, schema)?["suggestions"].clone())
}

/// `day`: what happened in a day or a longer period (hours by kind and project, rhythm, highlights,
/// the usual or the previous period to compare with) → {headline, points:[{label, text}]}
pub fn summary(s: &Settings, day: &Value) -> Result<Value, String> {
    // period: "день" (default), "месяц", "3 месяца", "год"
    let period = day["period"].as_str().unwrap_or("день").to_string();
    let voice = "Ты пишешь выжимку для личного трекера времени. Пиши по-русски, живо и конкретно, как наблюдательный друг,         а не бухгалтерский отчёт: называй настоящие вещи из данных (проекты, файлы, видео, чаты из заголовков),         замечай ритм и контраст, сравнивай с обычным или прошлым, если это есть в данных.         Только факты из данных, ничего не выдумывай и не додумывай причин. Без похвалы, морали, советов, эмодзи и восклицательных знаков.         Часы пиши как «2,5 ч», минуты как «40 мин», время как «09:40». Проекты с нулём не упоминай.";
    let task = if period == "день" {
        "Это один день. headline — суть дня одной фразой до 70 знаков, с конкретикой («День Aurora: лендинг в Figma и вечер в Deadlock»).          points — 3–4 пункта с label из одного-двух слов: «Главное» (на что ушла работа, 2–3 дела по смыслу),          «Ритм» (когда начал и закончил, самая длинная сессия, пик; сравни с usual, если он есть),          «Досуг» (что именно: игры, ролики, стримы), и если есть что-то необычное — «Заметка». text каждого пункта до 160 знаков."
            .to_string()
    } else {
        format!(
            "Это период «{period}». headline — суть периода одной фразой до 70 знаков.              points — 4–5 пунктов с label из одного-двух слов: «Главное» (сколько работы, 2–3 главных проекта),              «Сдвиги» (что выросло или упало к прошлому такому же периоду: previousByKind или previousMonthByKind, previous у проектов;              если сравнения нет, этот пункт пропусти), «Ритм» (в какие часы и дни недели работа, самый рабочий день, серия),              «Досуг», «Заметка» (одна деталь из highlights). text каждого пункта до 180 знаков."
        )
    };
    // the page says which language it shows; the settings decide when it doesn't
    let english = day["lang"].as_str().map(|l| l == "en").unwrap_or_else(crate::i18n::en);
    let lang = if english {
        " Write everything in English instead of Russian: the headline, the labels (Main, Rhythm, Leisure, Shifts, Note) and the texts. Hours like \"2.5 h\", minutes like \"40 min\", times like \"09:40\"."
    } else {
        ""
    };
    let system = format!("{voice} {task}{lang}");
    let schema = json!({
        "type": "object",
        "properties": {
            "headline": {"type": "string"},
            "points": {"type": "array", "items": {
                "type": "object",
                "properties": {"label": {"type": "string"}, "text": {"type": "string"}},
                "required": ["label", "text"],
                "additionalProperties": false
            }}
        },
        "required": ["headline", "points"],
        "additionalProperties": false
    });
    let v = ask(s, &system, &day.to_string(), schema)?;
    let points: Vec<Value> = v["points"].as_array().cloned().unwrap_or_default().into_iter().filter(|p| p["text"].as_str().is_some_and(|t| !t.trim().is_empty())).take(5).collect();
    Ok(json!({"headline": v["headline"].as_str().unwrap_or("").trim(), "points": points}))
}

/// `sessions`: [{id, minutes, project, items:[{app, title, minutes}]}] → [{id, title}]
/// A short human name for what the session was, so the list reads like a diary, not like window titles.
pub fn titles(s: &Settings, sessions: &Value) -> Result<Value, String> {
    let system = "Ты называешь рабочие сессии для трекера времени. Для каждой сессии дан список окон (программа, заголовок, минуты). \
        Придумай название на русском, 2–6 слов, про одно главное дело: «Макет лендинга Aurora в Figma», «Переписка с Kite Studio», «Релиз Nimbus 2.0». \
        Не перечисляй через запятые и «и»: выбери то, на что ушло больше минут, остальное отбрось. \
        Только факты из заголовков, без оценок и выдумок. Имена файлов, папок и проектов оставляй как есть.";
    let system = if crate::i18n::en() {
        format!("{system} Write the titles in English, 2–6 words, e.g. \"Aurora landing page in Figma\".")
    } else {
        system.to_string()
    };
    let schema = json!({
        "type": "object",
        "properties": {"titles": {"type": "array", "items": {
            "type": "object",
            "properties": {"id": {"type": "string"}, "title": {"type": "string"}},
            "required": ["id", "title"],
            "additionalProperties": false
        }}},
        "required": ["titles"],
        "additionalProperties": false
    });
    Ok(ask(s, &system, &json!({"sessions": sessions}).to_string(), schema)?["titles"].clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_is_found_inside_fences_and_prose() {
        assert_eq!(json_in("{\"ok\":true}").unwrap()["ok"], true);
        assert_eq!(json_in("```json\n{\"ok\": true}\n```").unwrap()["ok"], true);
        assert_eq!(json_in("Вот ответ: {\"a\": {\"b\": 1}} — готово").unwrap()["a"]["b"], 1);
        assert!(json_in("нет json").is_err());
    }
}
