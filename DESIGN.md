# Tempro landing: design notes

## Brief

- **Subject:** Tempro, automatic time tracking for Windows 10 and 11 (Rust + Tauri + React, MIT, github.com/Piwqust/tempro).
- **Audience:** people who work at a Windows computer for several clients or projects (designers, developers, freelancers) and ActivityWatch users who want projects instead of app lists.
- **Job:** explain in 3 seconds what it is, prove it with the product's own views, and send people to the installer on GitHub Releases.
- **Assets:** the brand mark (a 3×3 grid of days, the last one orange = now), Inter wordmark, project palette, demo-mode screenshots in `docs/screenshots`.
- **Language:** English, like the public repo and README. (The app itself speaks English and Russian.)
- **Assumptions:** production URL `https://tempro.angleford.co` (GitHub Pages, custom domain); download link = `releases/latest`; every number shown in the hero is demo data generated in the page, labelled as such.

## Concepts

| | Idea | Anchor | Signature | O / F / Fe / P |
|---|---|---|---|---|
| **A. Zoom out** (identity + product system) | The page is the grid from the logo: scrolling zooms out from one recorded day to a week, a month, 3 months and a year, and the app's own keys D W M Q Y work on the site | the mark *is* a heat map of days; the app's period keys D/W/M/Q/Y | one canvas camera pulls back from today's cell to the whole year; every cell is a real (demo) day with its project tracks | 5 / 5 / 4 / 1 |
| B. Raw and computed (material) | Every window title arrives raw in mono and is sorted into a project track as you scroll | raw events are never rewritten; rules recompute history | log rows fly into project tracks | 4 / 4 / 4 / 2 |
| C. One day, recorded (process) | Scroll is the clock of one day, sections are sessions, a presence stripe records down the page | day timeline, five presence states | a corner clock and stripe that record as you scroll | 3 / 4 / 5 / 3 |

**Pick A.** It cannot move to another product: the logo, the period keys and the "from a day to a year" promise are Tempro's own. Steal from B for the sorting section (mono = raw event, Inter = computed result) and from C for the five-state presence strip.

## Concept card

```
Idea:        Tempro's logo is a grid of days; the page zooms out of it, from one recorded day to a whole year.
Metaphor:    the app's own heat map and its period keys (D, W, M, Q, Y)
Signature:   sticky stage, one canvas camera: today's cell (with its project tracks and the "now" line)
             pulls back to the week, month, 3 months and the year. Keys D W M Q Y and T jump to a period.
             Recipe: patterns.md "Sticky stage" + driver module (camera = f(scroll progress, idle pulse)).
Emotion:     calm precision; "oh, that's my day, and that's my year"
Motion verb: record: things grow from the left edge along time with the orange now-line at the leading edge, then settle
Screenshot:  the hero: a huge rounded day cell with coloured project tracks, ghost neighbours around it,
             the question "What did you actually work on today?" beside it
```

## Art direction

**Palette** (taken from the app's light theme; the site is a single committed light theme, like the app's default):

| Role | Hex | Use |
|---|---|---|
| ground | `#ECECEC` | the app's canvas grey |
| surface | `#F7F7F7` | day cells at zoom, privacy ledger rows |
| ink | `#171717` | text, primary buttons, curtain, footer field |
| muted | `#5C5C5C` | secondary text (6.0:1 on ground) |
| line | `rgb(23 23 23 / 0.12)` | hairlines, empty cells |
| now | `#FF5A1F` | the logo's "now" cell: today, the now-line, the leading edge of a recording fill. Never small text |
| data | project palette (`#16A06A`, `#2F6BFF`, `#FF5A1F`, `#8B5CF6`, `#E5408A`, `#C28400`, `#0E9FA8`, `#E5484D`) and heat blue `#2F6BFF` | data only, never decoration |

**Type.** Inter (the wordmark and the app are Inter; changing it would break the brand) with the optical-size axis, so display sizes get the Display cut. The brand idea in type: big numerals in weight 300 with a small unit (`7.4 h`), straight from the app. JetBrains Mono only for raw data (window titles, process names, timestamps of raw events): mono means "as recorded", Inter means "as understood". Display tracking -0.045em at the largest size, -0.03em at t-xl; leading 0.95.

**Grid.** 12 columns, fluid gutter; three hang lines: column 1 (headings), column 5 (body and figures), column 9 (meta). Phones: 4 columns.

**Shape.** One radius rule from the mark (radius 4 on a 14 cell): radius = 0.28 × the short side of a cell, capped at 14 px. Buttons are cells too.

**Motion.** Engine eases (expo.out, expo.inOut, power3.out). Recording: `scaleX` from the left edge, 0.9 to 1.3 s, with a 2 px orange line riding the edge. Hovers 0.35 to 0.5 s. Page transition: seven bands (the weekdays) record in from the left, staggered 45 ms, and record out to the right on the new page.

**Micro-interactions (one per role):**
- Primary buttons: an ink fill records in from the left behind the label; the orange now-cell rides its edge.
- Nav links: underline records from the left; the current page keeps it.
- Period keys (D W M Q Y): the key cap fills like a cell; the active period stays filled.
- Inline links: underline at rest, rises into a band on hover.
- Footer/utility links: underline only.

**Idle.** The concept keeps moving at rest through its own clock: today's cell pulses like the logo's now-cell (1.8 s), and when today is the focus day the now-line and the open recording block advance in real time. Under reduced motion the pulse stops and the cell is outlined instead.

**No loader.** A product page earns craft, not theatre: the hero is real HTML text, the canvas records the day in during the intro.

**Reduced motion / no GL.** No sticky zoom: the stage becomes a normal section with the year shown whole, and the five periods are listed under it with their numbers; the period keys still jump the canvas, instantly.

## Composition plan (desktop 1440)

```
HERO + STAGE (sticky, 5 chapters, 520svh)               family: Scene / sticky narrative
┌ mark tempro ─────────────────────── Privacy  GitHub  [▮ Download] ┐
│ What did you actually       ┌───────────────────────────────┐    │
│ work on today?              │ ghost │  TODAY'S CELL          │    │
│ body, CTA, "Windows 10/11"  │ cells │  tracks + now line     │    │
│                             └───────────────────────────────┘    │
│ 7.4 h  Day                  [D][W][M][Q][Y]  demo data          │
└──────────────────────────────────────────────────────────────────┘
SORTING                                                  family: Index list (raw ↔ computed)
  h2 col1-4 | mono log rows col5-9 | project chips record in col10-12
PRESENCE                                                 family: full-bleed data strip
  h2 col1-6, one stripe edge to edge, labels hung under their own segments
SUMMARY                                                  family: Statement
  "7.4 h of work, mostly Tempro; evening: games." at t-xl, three short columns under it
THE APP                                                  family: Asymmetric pair
  day.png on 8 columns, year (dark) offset on 5 columns lower, captions on the hang lines
PRIVACY                                                  family: Data / facts
  four light numerals with labels (AES-256, 30 days, 127.0.0.1, 0 keystrokes), link to /privacy
INSTALL                                                  family: sequence (real steps, so numbered)
FOOTER (ink field)                                       family: Footer as finale
  giant wordmark built on the grid, Download, links, credits
```

/privacy: a ledger (what is recorded / counted / never kept / where it lives), FAQ. /404: an empty day, "Nothing was recorded at this address", key T or "Go to today".

## Genericness test

A generic model would give a dark hero with a purple glow, a floating app screenshot and three feature cards. Changed: the hero is the product's own heat map as a live camera, not a screenshot; features are carried by the zoom chapters instead of cards; the colour comes only from project data; the dark field is kept for the footer, where the "day" ends.

## Decisions made during QA

- **The open day.** At the Day stop the focus cell takes the canvas's shape (wider on desktop, taller on phones) and closes back into a square as the camera pulls back. Its neighbours stay faint until then.
- **Period emphasis.** Days outside the current period dim, so Week, Month and 3 months each show exactly their own days.
- **Idle.** On the home page the camera leans a little toward the pointer and breathes slowly; today's cell beats like the logo's now-cell. Privacy and 404 stay still on purpose (reading pages): only the header mark beats.
- **LCP.** The hero lede is not revealed with motion, so the largest text paints at once (mobile LCP ~1.2 s, throttled).
