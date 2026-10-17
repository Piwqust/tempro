# 03. Stack research

## Options

| | **A. Rust + Tauri 2 + React** | **B. C# / .NET 10** | **C. Electron + TypeScript** | **D. Fork of ActivityWatch 0.14** |
|---|---|---|---|---|
| Size and memory | ✅ ~10–15 MB, ~20–40 MB memory | 🟡 ~30–80 MB | ❌ 150–300 MB memory | ✅ (aw-tauri) |
| Windows API access | ✅ official `windows-rs`, sometimes verbose | ✅✅ everything native (WinRT, UIA, OCR) | 🟡 native modules, fragile | 🟡 custom watchers still have to be written |
| UI and charts | ✅ web, any design | 🟡 WinUI/Avalonia weaker for charts (WebView2 possible) | ✅ | ❌ old Vue, hard to change |
| Projects as an entity | ✅ own schema | ✅ | ✅ | ❌ conflicts with the pulse and category model |
| Development speed | 🟡 stricter, slower builds | ✅ | ✅✅ | ✅ fast start, then hits the limits of someone else's architecture |
| Mac/Linux later | ✅ | 🟡 | ✅ | ✅ |
| Reusing AW | ✅ aw-server-rust code (MPL-2.0, per-file license) | ❌ | ❌ | ✅ everything |

## Choice: A — Rust + Tauri 2, React + TypeScript, SQLite

- The ActivityWatch developers arrived at this stack themselves in 0.14.
- All required Windows APIs are available from Rust via `windows-rs`.
- Web UI: dashboards can be designed in Figma and implemented pixel for pixel.
- The build prerequisites are listed in `04-development-plan.md` → "Environment".
- Downside: Rust is stricter and compiles more slowly.
- Fallback: B (.NET) with a web UI in WebView2.

### Specific libraries (draft)

| Layer | Choice |
|---|---|
| Shell | Tauri 2 (tray, autostart `tauri-plugin-autostart`, single instance `tauri-plugin-single-instance`) |
| Windows API | `windows` (windows-rs), `uiautomation` (browser address fallback) |
| Database | SQLite via `rusqlite`, WAL mode |
| UI | React + TypeScript + Vite, Tailwind, custom components following the design |
| Charts | visx or ECharts (pick to match the references) |
| UI data | TanStack Query |
| Browser extension | Manifest V3, TypeScript |
| AI (stage 5) | Ollama locally or Claude API |

## Why not C++

C++ is technically viable: it talks to Windows directly and matches Rust in speed. It was not chosen for other reasons:

1. Speed is not the bottleneck: a tracker spends 99% of its time waiting for events.
2. The program runs in the background for months. Memory errors and data races, typical for C++, are caught by Rust at compile time. A silent tracker crash means a lost day of data.
3. Windows access is equivalent: `windows-rs` is generated from the same Windows API metadata.
4. Build: `cargo add` versus CMake + vcpkg/Conan.
5. UI: Rust has Tauri. C++ has Qt (size, licensing), WinUI 3 via C++/WinRT (hard), ImGui (not polished enough for a product) or weaker Tauri analogues (webview, Saucer).
6. The code is mostly written by AI: Rust's strict compiler immediately exposes the agent's mistakes.
7. Ready-made Rust code from aw-server-rust can be reused in parts.

C++ would be justified if: the team knows C++ well; a tiny UI-less `.exe` is needed; or low-level access such as process injection is required (a tracker does not need it).

## Ponytail

https://github.com/dietrichgebert/ponytail (v5.3.0 as of 2026-10-16, MIT)

- Not a tracker but a rule set for an AI coding agent: "smallest complete change", do not cut checks, security or error handling, keep a test for risky logic.
- Commands: `/ponytail [lite|full|ultra|off]`, `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt`.
- Version 5.3 adds "band" and "board": agent time, tokens and cost per project, stored locally in `~/.config/ponytail/band/`.
- **How we use it:**
  1. Install it in Claude Code for developing Tempro:
     ```
     /plugin marketplace add DietrichGebert/ponytail
     /plugin install ponytail@ponytail
     ```
  2. Data-source idea: per-project time from Claude Code sessions (`~/.claude/projects`).

## Similar projects (what to borrow)

| Project | What it is | What to take |
|---|---|---|
| [ActivityWatch](https://github.com/ActivityWatch/activitywatch) 0.14 | automatic tracker, MPL-2.0 | data schema, import, aw-server-rust, MV3 extension |
| [Screenpipe](https://github.com/screenpipe/screenpipe) | 24/7 screen recording + AI, Rust, Windows supported | accessibility → OCR as fallback, local API |
| [Dayflow](https://github.com/JerryZLiu/Dayflow) | screenshots → AI → day timeline, macOS, MIT | day cards and summaries, local models via Ollama/LM Studio |
| [Super Productivity](https://super-productivity.com/), [Kimai](https://www.kimai.org/) | manual tracking by task and project | reports, export, billable hours |
| Rize, Timing, ManicTime (paid) | automatic tracking with AI | the prompt after an absence, sorting out the "unsorted" |

## Sources

- https://activitywatch.net/blog/activitywatch-v0-14-0/
- https://github.com/activitywatch/activitywatch
- https://github.com/screenpipe/screenpipe
- https://github.com/JerryZLiu/dayflow , https://www.dayflow.so/
- https://super-productivity.com/blog/best-open-source-time-tracking-apps-2026/
- https://learn.microsoft.com/en-us/windows/dev-environment/rust/rust-for-windows
- https://hellocode.co/blog/post/tracking-active-process-windows-rust/
- https://crates.io/crates/uiautomation
- https://stackoverflow.com/questions/73592115/how-to-get-iaudiosessioncontrol2-in-windows-rs
- https://github.com/dietrichgebert/ponytail
