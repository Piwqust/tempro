# 04. Development plan

Stack: Rust + Tauri 2, React + TypeScript, SQLite (rationale in `03-stack-research.md`).

## Complexity estimate

| Part | Complexity | Comment |
|---|---|---|
| Window, input, AFK and screen-lock detection | 🟡 medium | Well-known APIs, care needed with sleep and user switching |
| SQLite database and ActivityWatch import | 🟢 easy | schema is documented in `01-activitywatch-analysis.md` |
| Project rules and history recomputation | 🟡 medium | the heart of the product |
| React UI | 🟡 medium, large | the most hours, depends on the design |
| Edge/Chrome extension | 🟢 easy | |
| Audio, media, microphone ("watching" and "call" states) | 🟡 medium | |
| AI and screenshots for the unrecognized | 🔴 hard | optional, last |

First working version (collects data, shows hours per project): a few sessions. A solid 1.0: roughly 2–4 weeks of evenings, with testing.

## Architecture (draft)

```
Tempro.exe (Tauri 2)
 ├─ Rust core
 │   ├─ collectors/   window, input, AFK/lock/sleep, audio/media, microphone, files, Claude Code
 │   ├─ store/        SQLite: raw_events (append-only), projects, rules, spans (computed)
 │   ├─ engine/       states + rules → spans with a project; history recomputation
 │   ├─ import/       import of ActivityWatch peewee-sqlite.v2.db
 │   └─ api/          Tauri commands for the UI + localhost for the browser extension
 ├─ UI (React)        Today · Week · Project · Unsorted · Rules · Settings
 └─ extension/        MV3 for Edge/Chrome: URL, tab, YouTube playback
```

## Stages

Each stage ends with a usable version.

### Stage 0. Skeleton ✅ (2026-10-16)
- Tauri 2 + React 19 + Vite 8, tray (open, focus, pause recording, quit), closing hides the window, single instance, autostart (`--minimized`).
- Database `%LOCALAPPDATA%\Tempro\tempro.db`, migrations via `PRAGMA user_version`, WAL.

### Stage 1. Data collection ✅
- Window tracking via `SetWinEventHook` events (window and title changes), 2 s timer as a safety net; UWP via the child window.
- Input via Raw Input counters (keystrokes, clicks, wheel, movements) per minute; XInput gamepad; idle via `GetLastInputInfo`.
- Screen lock, sleep and wake.
- ActivityWatch import up to the first own event, trimmed at the seam, re-runs without duplicates.
- "Log" («Журнал») screen with raw events.
- **Remaining:** 2–3 days of verification running in parallel with ActivityWatch.

### Stage 2. Projects ✅
- Context from the title: Figma, After Effects/Photoshop (file path), Cursor/VS Code (folder), browser, Telegram.
- Rules by field: program, title, document, URL, folder, "everywhere". Custom rules take precedence over built-in ones; among built-in ones, the keyword that appears earlier wins.
- Unsorted («Неразобранное») → rule → recomputation of the whole history. Projects, rules and settings are stored in the database.

### Stage 3. Design ✅
- Today, Week, Unsorted, Projects, project page (days, documents, programs, sessions), Log, Settings.
- CSV for Excel (semicolon-separated, BOM), hourly rate and total.

### Stage 4. Accuracy ✅
- Edge/Chrome extension (MV3): URL without parameters, title, whether a YouTube video is playing; private windows are skipped.
- "Video" states (program audio, video in the title, video playing) and "call" (microphone in use).
- Claude Code sessions: an "Agents" track; the session folder becomes the context of the Claude/terminal window.
- Question after an absence of 15 min – 3 h: meeting / call (with a project) / break; a "working on…" timer and hotkey.

### Stage 5. Optional ✅ (off by default)
- AI project suggestions in Unsorted and a day summary: Ollama locally or Claude API (`claude-opus-5-5`, JSON-schema response).
- Screen text (Windows OCR) only for "blind" programs, every N minutes, screenshots are not stored.
- The day summary without AI is always computed.

### What's next
- Real-world validation and rule tuning based on discrepancies.
- AI verified live on 2026-10-16 through a proxy (Haiku 5.5): session names, auto-sorting, new projects, summary.
- Move the computation into Rust if 30–90 days start loading slowly (currently 30 days ≈ 3 s in a debug build).
- Installer signing, so SmartScreen does not complain.

## Environment (verified 2026-10-16)

| Item | Status |
|---|---|
| Rust | stable-x86_64-pc-windows-msvc, cargo 1.94.1 ✅ (`rustup update` possible) |
| MSVC | Visual Studio Community 2022 with VC Tools ✅ |
| WebView2 | 155.0.4283.45 ✅ |
| Node | 26.8.1 ✅ |
| Bun | 1.4.2 ✅ |
| Python | 3.12 (for analysis scripts) ✅ |

## Open questions

1. ~~**UI references.**~~ Received 2026-10-16, see `05-design.md`. A Figma link is preferable; reading it directly requires the Figma connector to be authorized (`/mcp` in terminal `claude` or the connector settings on claude.ai). Otherwise screenshots/PNG. Also useful:
   - 2–3 apps with a feel worth matching;
   - what should be visible on the main screen in the first second;
   - optionally, custom mockups to implement pixel for pixel.
2. **List of projects and clients.** A draft can be assembled from the data (Figma file names, folders, chats), then reviewed.
3. **Policy decisions:**
   - what counts as work (for example, work chats in Telegram);
   - what is not stored at all (personal chats, sites);
   - screenshots: never / only for "gaps" / always;
   - whether an hourly rate is needed for export.
4. **Repository:** whether a GitHub repository is needed.
5. **Testing** after each stage: use it for a couple of days and report bugs.
6. **Details:** enable the extension in Edge in developer mode; accept SmartScreen once (the program is unsigned).

## Risks

- Antivirus may be wary of input tracking → only counters are taken (`GetLastInputInfo`, Raw Input without content), no keyboard hooks.
- While ActivityWatch runs in parallel, keep the databases separate: Tempro only reads its database during import.
- Privacy of titles (personal chats) → filter before writing to the database.
