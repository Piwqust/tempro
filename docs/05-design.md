# 05. Design

References from 2026-10-16, three images:

| Reference | What was taken | Where in Tempro |
|---|---|---|
| Timekeep: session list by day + colored tag blocks with large numbers | cards "time · duration / title", day label on the left (THU 16), project blocks with height proportional to hours, "no project" on top without fill, an "Add project" field right in the selected card | Today, Week: lower part |
| Linear-like task tracker | gray navigation pills in the sidebar, rounded content panel, breadcrumbs with arrows, a "Filter" button and a compound chip "Project · any of · 2 projects · ×", command menu with search, groups with colored status pills and a counter, popup picker with checkmarks | Sidebar, top of all screens, Unsorted («Неразобранное») |
| Animation editor with tracks | toolbar with timecode in the middle, ruler with labels and dots between them, flag-shaped playhead, clips with a colored header and a "waveform" inside, rows of keys with diamonds, faded future | Day timeline |

## Principles

- Calm gray canvas, white cards, color only for projects. One project = one saturated color.
- Large numbers in a light weight (Inter 300), smaller units: `7,8 ч`.
- UI text is in Russian, durations `25 мин`, `3,5 ч`, `22 ч`.
- Nothing hidden behind hover except secondary row actions ("Project" in Unsorted).
- Short animations (160–260 ms, ease-out), with `prefers-reduced-motion`.
- Light theme by default (as in the references), dark theme follows the system setting.

## Tokens

`app/src/styles/tokens.css`. Main ones:

| Token | Light | Purpose |
|---|---|---|
| `--canvas` | `#ececec` | window and sidebar background |
| `--panel` | `#f6f6f6` | main panel |
| `--surface` | `#ffffff` | cards |
| `--pill` | `#e2e2e2` | navigation pills |
| `--ink` … `--ink-4` | `#171717` … `#b4b4b4` | 4 text levels |
| `--focus` | `#8db0ff` | card selection and active filter |
| `--state-work / watch / away` | black / blue / gray dashed | state track |
| `--r-sm … --r-xl` | 8 / 11 / 16 / 22 px | corner radii |

Project palette (`engine/rules.ts → PALETTE`): orange `#FF5A1F`, purple `#6B17D6`, blue `#2F6BFF`, green `#16A06A`, pink `#E5408A`, amber `#E9A800`, teal `#0E9FA8`, red `#E5484D`, indigo `#3E3BB8`, brown `#8A6A4A`.

Font: Inter Variable (local via `@fontsource-variable/inter`, no network), `cv11 ss01 ss03`, tabular figures.

## Screens

1. **Today.** Timeline (Projects / Programs / State, zoom with Ctrl+wheel, pan with Shift+wheel, "fit" and "whole day"), below it a session list and project blocks. `[` and `]` page through days, Esc clears the selection.
2. **Week.** 7 day columns split by project (a click opens the day), below it the same list + blocks for the week.
3. **Unsorted.** Time without a project, grouped by program. A project is assigned to a row or to a whole program (the `+` button), and the rule is applied to the entire history.
4. **Projects.** Cards with hours for 30 days, rule chips, color, archive. New keywords are added right in the card.

5. **Project.** A colored banner with hours, 7 days, average per workday, rate; day bars (a click opens the day with a filter), documents and programs with bars, sessions and CSV.
6. **Log.** Raw events from all streams, newest first, filter by stream.
7. **Settings.** Section cards: recording, ActivityWatch, browser, privacy, screen text, AI, data.

Additions on Today: "While you were away" («Пока тебя не было») cards (blue border, like the active filter), a day summary line, and in the sidebar a focus timer with a pulsing dot in the project color. States on the track: work — solid dark, video — blue, call — green, pause — dots, away — gray dashed. Agents — striped capsules in the project color.

## Second version (2026-10-16, after feedback)

Feedback: the references were about mood, not for copying; the timeline looked odd and the "waveform" did not match reality.

- **Timeline = one track per project.** The project and its hours for the day on the left; blocks of when it was worked on on the right. "No project" is always the last row. Blocks merge only across pauses up to 45 s: a long block means long work. A sparse block (short visits) is paler than a solid one.
- **Removed:** the made-up "waveform" inside clips, key diamonds, the rainbow program track.
- **Honest rows below the projects:** Claude Code agents (thin stripes in the project color), input (bars from real counters — only for own data; ActivityWatch history has none, so the row is simply absent), presence (one stripe: work, video, call, pause, away).
- **Hover card** instead of text in the panel: project, time, document, programs with minutes, how much of the span was actually worked.
- **Day totals on top:** worked (and from when to when), sorted % with a link to Unsorted, most time (top 3 projects), AI summary.
- **Project distribution** instead of tall colored blocks: one 100% bar and rows with percentages. "No project" is no longer the main element of the screen.
- **"What you did":** ActivityWatch categories plus built-in ones (design, code, AI, video, games, social, communication).
- **Sessions:** time on the left, a colored project line, title (AI or document), project and program icons.
- **Sidebar:** regular full-width items; the list contains only projects that have time today.
- **Projects:** a table with a 30-day mini chart; rules, color and archive are on the project page.
- **Program icons** are real; a tile with initials is a quiet fallback.
- Fixed: the truncated "While you were away" question (now wraps), legend overlapping the time, "0 for 30 days" while loading, day total in Week, stretched archive button, extra telegram.exe in OCR, night-time questions.

## Activity kinds (2026-10-16)

Request: sort the entire history (ActivityWatch + Tempro) into projects and separate work from leisure.

- **A project has a kind:** Work («Работа»), Leisure («Досуг»), Personal («Личное»), Utility («Служебное», meaning "neither personal nor work": system, VPN, file explorer). It can be changed on the project page.
- **Day totals:** the main figure is Work (work projects only), next to it the total time at the computer; "Most time in work" excludes leisure.
- **"What you did"** is now by kind, a click filters the day to projects of that kind. ActivityWatch categories are no longer shown.
- **Leisure card** on Today and Week: leisure projects and what is behind them — games, videos, streams, music.
- **Sidebar and project table** are grouped by kind with a sum per group.
- **Shared rules** (`fallback`): "any YouTube tab", "Discord", "file explorer". They take only what matched none of the project keywords, so an "aurora showreel" video stays with aurora.
- History sorting result: work and leisure take most of the time, with small shares of personal and utility; a small remainder stays without a project (short tabs under 3 minutes).

## Kind-based timeline (2026-10-16)

Feedback: "the lines are mixed, unclear what goes where, impossible to read".

- **Top to bottom by kind:** Work, Leisure, Personal, Utility, No project. Each group is one row in the kind's color; a click expands its projects (only Work is open by default, the choice is remembered). Small projects (under 3 minutes, after the eighth) are folded into "N more".
- **Density instead of stripes:** a row is drawn in 3 px cells, saturation = the share of the cell's time actually spent there. 8 minutes scattered across the day stay pale instead of becoming a wall of two-pixel strokes. Blocks on top only catch hover and carry labels.
- **Hover card** for a kind row shows the projects within the span.
- **Week:** a day column is a stack of kinds (work at the bottom) instead of dozens of project colors; below it "N work out of M".

## Periods and long ranges (2026-10-17)

Request: "easy navigation between dates, a three-month breakdown, a year". References: Toggl and Clockify (preset periods, arrows keep the period length, bars coarsen as the range grows), GitHub and WakaTime (a year as a heatmap), Timing (when during the week you work). These are mood references, not a copy.

- **One top bar on all periods:** arrows, date button, "Back to current". The date opens a calendar: preset periods on the left, on the right a month by days (day, week) or a year by months (month, 3 months, year). Cells are tinted by work hours, hover outlines the range that a click will open.
- **Hotkeys** on physical keys (they work in the Russian layout too): ← → / [ ], T, D W M Q Y.
- **3 months** — three months ending with the selected one: "the last three months" is how people say it; a calendar quarter is an accounting term.
- **Honest comparison:** the current period is compared with the same number of days before it. If the previous range was not recorded, there is no comparison and no "new" markers at all.
- **A day without records ≠ a day without work:** in the heatmap it is outlined, not filled gray.
- **A year does not load raw events in full:** each month is computed by the same engine and condensed to daily totals; while months are being computed the totals are dimmed and a progress bar runs on top.

## Design next steps

- Custom Figma mockups, if more precision is needed (requires the Figma connector).
- Drag on the timeline to select a span and assign a project to it.
