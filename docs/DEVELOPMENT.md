# Development

How to build, test and install Tempro, and how it is put together. What the app does is in the [README](../README.md).

## Requirements

- Windows 10 or 11 (x64).
- [Rust](https://rustup.rs) (stable, MSVC) and the Visual Studio Build Tools with "Desktop development with C++": SQLCipher and libtomcrypt are compiled from source in `build.rs`, no OpenSSL needed.
- [Bun](https://bun.sh) 1.x (or Node 20+ via `node node_modules/...`).
- WebView2 (already part of Windows 11).

## Running

```
cd app
bun install
bun run tauri dev    # the app: window, tray, recording
bun run dev          # the interface only, in a browser at http://localhost:1420
```

If `bun run tauri dev` fails on Bun's shims ("could not create process"), run `bun run dev` in one terminal and `node node_modules/@tauri-apps/cli/tauri.js dev --config "{\"build\":{\"beforeDevCommand\":\"\"}}"` in another.

In the browser the interface talks to a running debug build (through Vite's proxy to `127.0.0.1:5601`). Without one it shows ActivityWatch history only.

**Demo mode:** `http://localhost:1420/?demo` shows five months of a made-up person, generated in the page (`app/src/data/demo.ts`); no backend needed. Parameters: `screen=today|week|month|quarter|year|project`, `day=-9` (days from today), `project=p_tempro`, `locked`. The screenshots in `docs/screenshots` come from it.

**Next to an installed Tempro:** a debug build started with `TEMPRO_SIDE=1` runs beside the installed one (no single-instance check, HTTP on `TEMPRO_PORT`), and Vite is pointed at it with `TEMPRO_API`. In release builds `TEMPRO_SIDE` does nothing.

```
cd app/src-tauri && cargo build
set TEMPRO_SIDE=1& set TEMPRO_PORT=5611& target\debug\tempro.exe --minimized
set TEMPRO_API=http://127.0.0.1:5611& bun run dev      # in app/
```

Otherwise the debug and installed builds share the database and the "already running" check: quit the installed one from the tray before `tauri dev`.

Browser extension: `edge://extensions` → developer mode → "Load unpacked" → the [extension/](../extension/) folder.

## Tests

```
cd app && bun test                       # engine: states, rules, sessions, periods, icons
cd app && bun run build                  # types + frontend build
cd app/src-tauri && cargo test --lib     # event merging, encryption, compaction, password, watchdog
```

GitHub Actions runs the same on every push (`.github/workflows/ci.yml`).

## Building and installing

```
powershell -ExecutionPolicy Bypass -File scripts\release.ps1            # build and reinstall
powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -NoBuild   # reinstall the last build
powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -BuildOnly # installer only
```

The script builds the NSIS installer (`app/src-tauri/target/release/bundle/nsis/Tempro_<version>_x64-setup.exe`), pauses the watchdog, installs silently into `%LOCALAPPDATA%\Tempro\tempro.exe`, refreshes Explorer's icon cache and starts Tempro in the tray. The database is left alone.

A `v*` tag runs `.github/workflows/release.yml`: the installer is built on GitHub and attached to a draft release.

**Run it from a normal terminal.** Inside packaged (MSIX) apps Windows redirects writes to AppData and HKCU into the package's private copy, so the install would end up where Explorer, Task Scheduler and autostart can't see it. From there, use `-BuildOnly` and install with `scripts\install-outside.cmd` (double-click it; it also moves a database out of such a private copy if there is no real one yet).

## Running unattended

- **Autostart** at Windows sign-in; the installed copy takes it over on first start.
- **Watchdog:** the Task Scheduler task `Tempro\Watchdog` checks every 5 minutes and at sign-in whether Tempro is alive and starts it if not. Quitting from the tray is respected until the next manual start or sign-in.
- **Crashes** are written to `%LOCALAPPDATA%\Tempro\crash.log`; the latest ones are shown in the settings.
- **Background jobs** (auto-sorting, compaction of old details) live in the window, which can stay hidden in the tray for weeks. The backend sends it a `tick` event every 10 minutes.

## Where things are

| What | Path |
|---|---|
| App | `%LOCALAPPDATA%\Tempro\tempro.exe` |
| Database | `%LOCALAPPDATA%\Tempro\tempro.db` (SQLCipher, WAL) |
| Crash log | `%LOCALAPPDATA%\Tempro\crash.log` |
| Keys | Windows Credential Manager: `Tempro/database`, `Tempro/ai-key` |
| Claude Code sessions (read only) | `%USERPROFILE%\.claude\projects` |

```
app/src-tauri/src/
  sensors.rs   window, input, lock, sleep, audio, microphone, gamepad
  ocr.rs       screen text (Windows.Media.Ocr)
  agents.rs    Claude Code sessions
  aw.rs        ActivityWatch import
  guard.rs     watchdog, crash log, "running" marker
  secrets.rs   keys in Windows Credential Manager
  lock.rs      password for the log and the window (PBKDF2-HMAC-SHA256)
  db.rs        schema, migrations, heartbeat merging, reads, compaction
  state.rs     writer thread, presence state machine, privacy filters
  server.rs    127.0.0.1:5601 for the extension and the browser mode
  api.rs       every command the interface calls
  ai.rs        Ollama / Claude API: projects, session names, summaries
  icons.rs     app icons from exe files → PNG
app/src/
  engine/      context, rules, states, sessions, daily summaries, project icons, tests
  data/        backend calls, projects and rules, settings, monthly totals, demo data
  lib/         time, periods, CSV
  ui/ screens/ components and screens
extension/     Edge/Chrome extension (Manifest V3, no build step)
brand/         logo files and the script that generates them (python brand/logo.py)
```

## Decisions

- Stack: Rust + Tauri 2, React 19 + TypeScript, SQLite (SQLCipher). Styles: plain CSS tokens, no Tailwind.
- Raw events are append-only (only the last row of a stream grows); projects are computed on top and recomputed when rules change.
- States and projects are computed in TypeScript: one code path for the app window, the browser and the demo mode, covered by `bun test`.
- Long periods (3 months, a year) are computed month by month with the same engine and reduced to daily totals (`engine/summary.ts`, `data/daysum.ts`), so a year of raw events is never held in memory.
- Projects, rules and settings live in the same database (`kv`).
- Compaction of old details is decided by the frontend: the engine assigns each old row its project (`pinsFor`), the backend wipes the title and keeps the project.
- The password is never stored: a salt and PBKDF2 (310,000 iterations) in the encrypted database, under a key the page cannot write. The backend refuses the log and the recovery key until the window is unlocked.
- The wordmark is Inter SemiBold (SIL Open Font License), outlined into the SVGs, so no font is shipped.

## Documents

| File | Topic |
|---|---|
| [01-activitywatch-analysis.md](01-activitywatch-analysis.md) | how ActivityWatch works and why Tempro exists |
| [02-detection-methods.md](02-detection-methods.md) | signal sources, the state model, blind spots |
| [03-stack-research.md](03-stack-research.md) | choosing the stack: Rust + Tauri 2 + React |
| [04-development-plan.md](04-development-plan.md) | stages and what was done in each |
| [05-design.md](05-design.md) | principles, tokens, screens, periods |
