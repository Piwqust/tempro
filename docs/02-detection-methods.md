# 02. Detecting work, project and AFK accurately

Goal: for every time span, know the **state** (working / watching / call / pause / away) and the **project**.

## Blind spots in typical data

| Program | Project in the data |
|---|---|
| Figma | ✅ file name in the title |
| After Effects | ✅ `.aep` path → project folder |
| Cursor | ✅ "task – folder – Cursor" |
| Edge / Chrome | ⚠️ tab title only, the address is needed |
| Telegram | ❌ "Media viewer", chat names |
| ChatGPT / Claude | ❌ the title is always the same |
| Orca | ❌ |

Browsers, messengers and AI chats make up a large share of active time that cannot be tied to a project by title alone. The sources below are needed.

## Signal sources (from simple to heavy)

### 1. Active window
- `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` + `EVENT_OBJECT_NAMECHANGE` for title changes. Event-driven, no once-per-second polling.
- Record: process, full exe path, title, monitor, fullscreen state.
- Very short switches (<1–2 s) are merged during aggregation, but raw events are never dropped.

### 2. Document context inside a program
| Source | What it provides |
|---|---|
| Figma (desktop) | file name from the title |
| Figma (browser) | file key from the URL `figma.com/design/<key>/...` |
| After Effects / Photoshop / Illustrator / Premiere | project file path from the title |
| Cursor / VS Code | workspace folder from the title |
| Browser extension (MV3) | URL, domain, title; on YouTube: video id, channel, whether it is playing |
| Claude Code | sessions in `~/.claude/projects/<folder>/*.jsonl`: working folder and timestamps (this is how the Ponytail board works) |
| File system | saves in project folders (`ReadDirectoryChangesW`) |
| Windows recent files | `%APPDATA%\Microsoft\Windows\Recent`, jump lists |
| Browser without the extension (fallback) | address bar via UI Automation (the `uiautomation` crate) |

### 3. Work intensity
- Count only quantities: keystrokes, clicks, scrolling, mouse movement per minute. **Keystroke content is never recorded.**
- Window-switch frequency → "focused" or "scattered" work.

### 4. States instead of "here / away"

| State | How it is detected |
|---|---|
| Working | input within the last N seconds (`GetLastInputInfo`, Raw Input counters) |
| Watching / reading | no input, but the foreground program is playing audio/video (audio sessions `IAudioSessionManager2` → PID; media sessions `GlobalSystemMediaTransportControlsSessionManager`) or the window is fullscreen |
| Call | microphone in use (registry `CapabilityAccessManager\ConsentStore\microphone` → `LastUsedTimeStart/Stop` per program) |
| Pause | short silence, 2–5 min |
| Away | screen locked (`WTSRegisterSessionNotification`), sleep (`WM_POWERBROADCAST`), long silence |

Additionally: a gamepad (XInput) counts as input.

### 5. Ask the user
- After returning from a long pause: "meeting / break / call about project X?".
- Once a day: "2 h in Telegram and ChatGPT are unassigned, sort them out?".
- Answers become rules.
- Manual timer and a hotkey "working on X now".

### 6. Heavy artillery (optional)
- Screenshot → OCR (built-in Windows `Windows.Media.Ocr`) or a local vision model.
- This is how Screenpipe (Rust, Windows supported, accessibility first, OCR as fallback) and Dayflow (macOS, screenshots → AI → day cards) work.
- Enable only for "gaps" where the project could not be determined. The main risks are privacy and load.

## How a project is assigned

1. **Rules** (by program, title, URL, file path, folder).
2. **User corrections** → new rules, with priority.
3. **AI for the unrecognized:** locally (Ollama) or Claude once a day in a batch.

**Main principle:** raw events are append-only and never modified. Project spans are computed on top of them. Change a rule and the whole history is recomputed.
