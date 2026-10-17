# 01. ActivityWatch, taken apart

Where Tempro started: how ActivityWatch works, what doesn't fit time tracking for work, and what follows from that. Written on 2026-10-16 against version 0.13.x (Python 3.9, PyInstaller); the current version at the time was 0.14.0.

## Where things are (Windows)

| What | Path |
|---|---|
| Program | `%LOCALAPPDATA%\Programs\ActivityWatch` (≈300 MB) |
| Data and settings | `%LOCALAPPDATA%\activitywatch\activitywatch` |
| Event database | `...\activitywatch\aw-server\peewee-sqlite.v2.db` |
| Categories and UI settings | `...\activitywatch\aw-server\settings.json` |
| Queue of unsent events | `...\activitywatch\aw-client\queued\*.persistqueue\data.db` |

## How it works

```
aw-qt (tray icon, starts the modules)
 ├─ aw-watcher-window  every 1 s: active window (app + title)
 ├─ aw-watcher-afk     every 5 s: mouse/keyboard; 180 s of silence = AFK
 └─ aw-server          REST on localhost:5600 → SQLite (peewee) → web UI (Vue)
```

- Watchers send the server heartbeats. Identical consecutive events are merged into one while the gap between them is shorter than `pulsetime`.
- Categories are regular expressions over `app` and `title`, stored in `settings.json` → `classes`.
- AFK and the active window live in separate buckets. Active time is the intersection of the window with `not-afk` periods, computed by the UI at query time.

## Database schema (for the import)

```sql
CREATE TABLE bucketmodel (
  key INTEGER PRIMARY KEY, id VARCHAR(255), created DATETIME, name VARCHAR(255),
  type VARCHAR(255), client VARCHAR(255), hostname VARCHAR(255), datastr VARCHAR(255));
CREATE TABLE eventmodel (
  id INTEGER PRIMARY KEY, bucket_id INTEGER REFERENCES bucketmodel(key),
  timestamp DATETIME, duration DECIMAL(10,5), datastr VARCHAR(255));  -- datastr = JSON
```

Buckets: `aw-watcher-window_<hostname>` (currentwindow), `aw-watcher-afk_<hostname>` (afkstatus), sometimes `aw-stopwatch`.

Window `datastr`: `{"app": "Figma.exe", "title": "Aurora — website - Figma"}`; AFK: `{"status": "afk" | "not-afk"}`. Times are stored in UTC.

## What the titles reveal

- About half of the window events are shorter than 2 s: noise from switching.
- Raw sums without subtracting AFK are inflated almost twofold.
- **Figma:** `<file> - Figma`, and the file is almost always the project.
- **After Effects:** the full project path, `Adobe After Effects 2026 - C:\Work\motion\intro.aep *`: the project shows in the folder and file name.
- **Cursor, VS Code:** `task - folder - Cursor`: the folder is the project.
- **Edge:** `<tab title> and 18 more pages - Personal - Microsoft Edge`. No address.
- **Telegram:** the chat name.
- **ChatGPT, Claude:** the title never changes, so the project can't be told from it.

## Problems found

1. **Heavy.** Every module ships its own Python: ≈300 MB on disk, 4 processes and ≈175 MB of memory; polling the window once a second costs about 3% of one core.
2. **No browser extension** → no page addresses; YouTube is visible only by the word in the title.
3. **Video = AFK.** A video watched without touching the mouse counts as absence after 3 minutes.
4. **Default categories** aren't about work (GIMP, Kdenlive, Minecraft…), and Figma or After Effects aren't set up.
5. **No projects as a concept.** Only a hierarchy of categories built from regular expressions.
6. **The interface** is hard to read.

## What's new in ActivityWatch 0.14.0 (2026-10-06)

Source: https://activitywatch.net/blog/activitywatch-v0-14-0/

- A new `aw-tauri` app (Tauri + an embedded Rust server), lighter than the classic one, not yet the default.
- Faster on large databases: indexes, WAL, cached category rules, loading by day.
- Sync between devices through a folder, no server.
- A timeline with lanes, AFK filters, category sets and rule priorities.
- A working-hours report and export of billable hours per category.
- A privacy filter for titles before they're stored, an API key, Russian translation.

Conclusion: the developers themselves moved to Rust + Tauri. The "heartbeat → title → category" model stays, and there are still no projects. Tempro keeps the same way of collecting data but computes projects and states (work, video, call, pause) and stores everything encrypted.
