// Demo mode (`?demo` in the address): a made-up person's five months, generated in the page, so
// screenshots and a public preview never show anyone's real windows. Deterministic: the same day
// always comes out the same. Nothing here reaches a backend.
import { KIND_LABEL, PALETTE } from "../engine/rules";
import type { Project, RawAfk, RawAgent, RawEvents, RawInput, RawWindow, Rule } from "../engine/types";
import { getLang, num } from "../lib/i18n";
import { addDays, startOfDay } from "../lib/time";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAYS = 150;

type Act = { app: string; title: string };
type P = Project & { keys?: string[]; apps?: string[]; acts: Act[]; agent?: string; from?: number; to?: number; weight: number };

// the made-up person speaks the interface language: names, titles and chats
const L = (ru: string, en: string) => (getLang() === "en" ? en : ru);
const edge = (t: string) => ({ app: "msedge.exe", title: `${t} - Microsoft Edge` });
const now0 = startOfDay(Date.now());
const ago = (d: number) => addDays(now0, -d);

const WORK: P[] = [
  {
    id: "p_aurora", name: L("Aurora — сайт", "Aurora — website"), color: PALETTE[0], kind: "work", keys: ["aurora"], weight: 3, from: ago(95),
    acts: [
      { app: "Figma.exe", title: "Aurora — website - Figma" },
      { app: "Figma.exe", title: "Aurora — mobile - Figma" },
      edge("Aurora — staging"),
      { app: "Telegram.exe", title: L("Aurora · команда", "Aurora · team") },
    ],
  },
  {
    id: "p_nimbus", name: "Nimbus App", color: PALETTE[1], kind: "work", keys: ["nimbus"], weight: 3, from: ago(150), to: ago(35), agent: "C:\\Code\\nimbus",
    acts: [
      { app: "Cursor.exe", title: "App.tsx - nimbus - Cursor" },
      { app: "Cursor.exe", title: "sync.ts - nimbus - Cursor" },
      { app: "WindowsTerminal.exe", title: "bun test — nimbus" },
      edge("Pull request #214 · nimbus · GitHub"),
    ],
  },
  {
    id: "p_kite", name: "Kite Studio", color: PALETTE[2], kind: "work", keys: ["kite"], weight: 2,
    acts: [
      { app: "Telegram.exe", title: L("Kite Studio · дизайн", "Kite Studio · design") },
      { app: "Figma.exe", title: "Kite × Spring campaign - Figma" },
      edge(L("Kite Studio — бриф - Google Docs", "Kite Studio — brief - Google Docs")),
    ],
  },
  {
    id: "p_tempro", name: "Tempro", color: PALETTE[3], kind: "work", keys: ["tempro"], weight: 4, from: ago(28), agent: "C:\\Code\\tempro",
    acts: [
      { app: "Cursor.exe", title: "Range.tsx - tempro - Cursor" },
      { app: "Cursor.exe", title: "lock.rs - tempro - Cursor" },
      { app: "WindowsTerminal.exe", title: "cargo test — tempro" },
    ],
  },
  {
    id: "p_motion", name: L("Дизайн и моушн", "Design & motion"), color: PALETTE[4], kind: "work", keys: ["motion\\"], weight: 0.7,
    acts: [
      { app: "AfterFX.exe", title: "Adobe After Effects 2026 - C:\\Work\\motion\\intro.aep" },
      { app: "AfterFX.exe", title: "Adobe After Effects 2026 - C:\\Work\\motion\\logo-reveal.aep" },
    ],
  },
  { id: "p_ai", name: L("ИИ-чаты и генерация", "AI chats"), color: PALETTE[5], kind: "work", apps: ["chatgpt.exe"], weight: 1.1, acts: [{ app: "ChatGPT.exe", title: "ChatGPT" }] },
];

const FUN: P[] = [
  {
    id: "p_video", name: L("Видео", "Video"), color: PALETTE[6], kind: "leisure", keys: ["youtube"], weight: 3,
    acts: (getLang() === "en"
      ? ["How font rendering works", "Lo-fi beats to code to", "The Pixar story in 20 minutes", "Speedrun Celeste Any%", "How GPS works"]
      : ["Как устроен рендеринг шрифтов", "Lo-fi beats to code to", "История Pixar за 20 минут", "Speedrun Celeste Any%", "Как работает GPS"]
    ).map((t) => edge(`${t} - YouTube`)),
  },
  { id: "p_games", name: L("Игры", "Games"), color: PALETTE[7], kind: "leisure", apps: ["deadlock.exe", "steam.exe"], weight: 3, acts: [{ app: "deadlock.exe", title: "Deadlock" }, { app: "steam.exe", title: "Steam" }] },
  { id: "p_streams", name: L("Стримы", "Streams"), color: PALETTE[8], kind: "leisure", keys: ["twitch"], weight: 1, acts: [edge("speedrun_marathon - Twitch")] },
  { id: "p_music", name: L("Музыка", "Music"), color: PALETTE[9 % PALETTE.length], kind: "leisure", apps: ["spotify.exe"], weight: 0.6, acts: [{ app: "Spotify.exe", title: "Spotify Premium" }] },
];

const LIFE: P[] = [
  { id: "p_personal", name: L("Личное", "Personal"), color: "#8A8FA3", kind: "personal", keys: [L("семья", "family"), L("ozon", "amazon")], weight: 1, acts: [{ app: "Telegram.exe", title: L("Семья", "Family") }, edge(L("Ozon — корзина", "Amazon — cart"))] },
  { id: "p_system", name: L("Служебное", "Utility"), color: "#6B7280", kind: "system", apps: ["explorer.exe", "systemsettings.exe"], weight: 1, acts: [{ app: "explorer.exe", title: L("Загрузки", "Downloads") }, { app: "SystemSettings.exe", title: L("Параметры", "Settings") }] },
];

// nobody's rules catch these: they end up in "Неразобранное"
const STRAY: Act[] = [edge(L("Новая вкладка", "New tab")), { app: "Notion.exe", title: "Untitled" }, edge(L("Погода в Москве", "Weather in London"))];

const ALL = [...WORK, ...FUN, ...LIFE];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T extends { weight: number }>(list: T[], r: () => number): T {
  const sum = list.reduce((n, x) => n + x.weight, 0);
  let x = r() * sum;
  for (const it of list) if ((x -= it.weight) <= 0) return it;
  return list[list.length - 1];
}

type Day = { window: RawWindow[]; afk: RawAfk[]; agent: RawAgent[]; input: RawInput[] };
const cache = new Map<number, Day>();

function genDay(day: number): Day {
  const hit = cache.get(day);
  if (hit) return hit;
  const r = rng(Math.floor(day / 86_400_000) * 7919);
  const out: Day = { window: [], afk: [], agent: [], input: [] };
  cache.set(day, out);
  if (day < ago(DAYS) || r() < 0.05) return out;
  const wd = new Date(day).getDay();
  const weekend = wd === 0 || wd === 6;
  const working = weekend ? r() < 0.3 : r() < 0.93;

  let t = day + (8.3 + r() * 2.2) * HOUR;
  const active = WORK.filter((p) => (p.from ?? 0) <= day && day < (p.to ?? Infinity));
  const block = (p: P | null, len: number, game = false) => {
    const end = t + len;
    out.afk.push({ ts: t, dur: len / 1000, afk: false, kind: "input" });
    if (p?.agent && r() < 0.8) out.agent.push({ start: t + 5 * MIN, end: end - 5 * MIN, cwd: p.agent, session: `s${t}`, entry: "claude" });
    while (t < end) {
      const stray = !game && r() < 0.05;
      // real work hops: a chat, the AI, someone else's file
      const hop = !game && p?.kind === "work" && r() < 0.14 ? pick([...active, ...LIFE], r) : p;
      const a = stray ? STRAY[Math.floor(r() * STRAY.length)] : hop ? hop.acts[Math.floor(r() * hop.acts.length)] : STRAY[0];
      const d = Math.min(end - t, (game ? 20 + r() * 40 : 1 + r() * 7) * MIN);
      out.window.push({ ts: t, dur: d / 1000, app: a.app, title: a.title });
      for (let m = Math.floor(t / MIN) * MIN; m < t + d; m += MIN)
        out.input.push({ minute: m / MIN, keys: game ? Math.floor(r() * 30) : Math.floor(20 + r() * 140), clicks: Math.floor(r() * (game ? 120 : 30)), wheel: Math.floor(r() * 20), moves: Math.floor(40 + r() * 200) });
      t += d;
    }
  };
  const gap = (len: number) => {
    out.afk.push({ ts: t, dur: len / 1000, afk: true, kind: "idle" });
    t += len;
  };

  if (working) {
    const until = t + (weekend ? 1.5 + r() * 2 : 6 + r() * 3.5) * HOUR;
    let lunch = false;
    while (t < until) {
      block(pick(active, r), (20 + r() * 90) * MIN);
      if (r() < 0.25) block(pick(LIFE, r), (3 + r() * 10) * MIN);
      if (!lunch && new Date(t).getHours() >= 13) {
        gap((35 + r() * 30) * MIN);
        lunch = true;
      } else gap((2 + r() * 14) * MIN);
    }
  }
  // the evening
  t = Math.max(t + 30 * MIN, day + (19 + r() * 2) * HOUR);
  const evening = t + (weekend ? 2 + r() * 3 : 0.8 + r() * 2.5) * HOUR;
  while (t < evening) {
    const p = pick(FUN, r);
    block(p, (p.id === "p_games" ? 40 + r() * 80 : 10 + r() * 40) * MIN, p.id === "p_games");
    if (r() < 0.3) block(LIFE[0], (5 + r() * 15) * MIN);
    gap((1 + r() * 6) * MIN);
  }
  return out;
}

function events(from: number, to: number): RawEvents {
  const now = Date.now();
  const ev: RawEvents = { window: [], afk: [], agent: [], input: [] };
  for (let d = startOfDay(from - 12 * HOUR); d < to; d = addDays(d, 1)) {
    const g = genDay(d);
    const live = <T extends { ts: number; dur: number }>(e: T) => e.ts < Math.min(to, now) && e.ts + e.dur * 1000 > from;
    const cut = <T extends { ts: number; dur: number }>(e: T): T => (e.ts + e.dur * 1000 > now ? { ...e, dur: (now - e.ts) / 1000 } : e);
    ev.window.push(...g.window.filter(live).map(cut));
    ev.afk.push(...g.afk.filter(live).map(cut));
    ev.agent!.push(...g.agent.filter((a) => a.start < Math.min(to, now) && a.end > from).map((a) => ({ ...a, end: Math.min(a.end, now) })));
    ev.input!.push(...g.input.filter((i) => i.minute * MIN >= from && i.minute * MIN < Math.min(to, now)));
  }
  return ev;
}

function store(): { projects: Project[]; rules: Rule[]; version: 1 } {
  const rules: Rule[] = [];
  for (const p of ALL) {
    for (const k of p.keys ?? []) rules.push({ id: `r_${p.id}_${k}`, projectId: p.id, field: "any", op: "contains", value: k, source: "default", created: 0 });
    for (const a of p.apps ?? []) rules.push({ id: `r_${p.id}_${a}`, projectId: p.id, field: "app", op: "equals", value: a, source: "default", created: 0 });
  }
  return { projects: ALL.map(({ id, name, color, kind }) => ({ id, name, color, kind })), rules, version: 1 };
}

// ---- a written summary, made from the same numbers the page sends to the AI ----
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payload = Record<string, any>;
const hrs = (h: number) => `${num(h)} ${L("ч", "h")}`;

function summary(d: Payload) {
  const en = getLang() === "en";
  const WORK_K = KIND_LABEL.work;
  const FUN_K = KIND_LABEL.leisure;
  const work = (d.byProject ?? []).filter((p: Payload) => p.kind === WORK_K && p.hours > 0);
  const fun = (d.byProject ?? []).filter((p: Payload) => p.kind === FUN_K && p.hours > 0);
  const top = work.slice(0, 3).map((p: Payload) => `${p.name} — ${hrs(p.hours)}`).join(", ");
  const w = d.byKind?.[WORK_K] ?? 0;
  if (d.period === "день" || d.period === "day") {
    const r = d.rhythm ?? {};
    const u = d.usual ? hrs(d.usual.workHoursOnWorkingDay) : "";
    const more = d.usual ? w > d.usual.workHoursOnWorkingDay : false;
    const usual = !d.usual ? "" : en ? `${more ? "above" : "below"} your usual ${u}` : `${more ? "больше" : "меньше"} обычных ${u}`;
    const longest = r.longestSession?.title ?? "—";
    const mins = r.longestSession?.minutes ?? 0;
    if (en)
      return {
        headline: work[0] ? `${hrs(w)} of work, mostly ${work[0].name}${fun[0] ? `; evening: ${fun[0].name.toLowerCase()}` : ""}` : "A quiet day",
        points: [
          { label: "Main", text: `${hrs(w)} of work${usual ? `, ${usual}` : ""}: ${top}.` },
          { label: "Rhythm", text: `${r.start} to ${r.end}, ${r.sessions} sessions. Longest: “${longest}”, ${mins} min; busiest ${r.busiestWorkHour ?? "midday"}.` },
          { label: "Leisure", text: fun.length ? `${hrs(d.byKind?.[FUN_K] ?? 0)}: ${fun.map((p: Payload) => p.name.toLowerCase()).join(", ")}.` : "Hardly any leisure." },
        ],
      };
    return {
      headline: work[0] ? `${hrs(w)} работы, в основном ${work[0].name}${fun[0] ? `; вечером — ${fun[0].name.toLowerCase()}` : ""}` : "Тихий день",
      points: [
        { label: "Главное", text: `${hrs(w)} работы${usual ? `, ${usual}` : ""}: ${top}.` },
        { label: "Ритм", text: `С ${r.start} до ${r.end}, ${r.sessions} сессий. Самая длинная — «${longest}», ${mins} мин; плотнее всего ${r.busiestWorkHour ?? "днём"}.` },
        { label: "Досуг", text: fun.length ? `${hrs(d.byKind?.[FUN_K] ?? 0)}: ${fun.map((p: Payload) => p.name.toLowerCase()).join(", ")}.` : "Досуга почти не было." },
      ],
    };
  }
  const prev = d.previousByKind ?? d.previousMonthByKind;
  const pw = prev?.[WORK_K];
  const h = d.highlights ?? {};
  if (en)
    return {
      headline: `${d.date}: ${hrs(w)} of work, led by ${work[0]?.name ?? "—"}`,
      points: [
        { label: "Main", text: `${top}.` },
        ...(pw ? [{ label: "Shifts", text: `${w >= pw ? "More" : "Less"} work than last time: ${hrs(w)} vs ${hrs(pw)}.` }] : []),
        { label: "Rhythm", text: `${h.workingDays ?? 0} working days, most often ${d.rhythm?.busiestWeekday ?? "on weekdays"}, ${d.rhythm?.busiestWorkHours ?? ""}. Streak: ${h.longestWorkStreakDays ?? 0} days in a row.` },
        { label: "Note", text: h.busiestWorkDay ? `Busiest day: ${h.busiestWorkDay.date}, ${hrs(h.busiestWorkDay.workHours)} of work.` : "An even period with no peaks." },
      ],
    };
  return {
    headline: `${d.date}: ${hrs(w)} работы, впереди ${work[0]?.name ?? "—"}`,
    points: [
      { label: "Главное", text: `${top}.` },
      ...(pw ? [{ label: "Сдвиги", text: `Работы ${w >= pw ? "больше" : "меньше"}, чем в прошлый раз: ${hrs(w)} против ${hrs(pw)}.` }] : []),
      { label: "Ритм", text: `${h.workingDays ?? 0} рабочих дней, чаще всего ${d.rhythm?.busiestWeekday ?? "в будни"}, ${d.rhythm?.busiestWorkHours ?? ""}. Серия — ${h.longestWorkStreakDays ?? 0} дней подряд.` },
      { label: "Заметка", text: h.busiestWorkDay ? `Самый плотный день — ${h.busiestWorkDay.date}: ${hrs(h.busiestWorkDay.workHours)} работы.` : "Ровный период без пиков." },
    ],
  };
}

const kv = new Map<string, unknown>();
let saved: ReturnType<typeof store> | null = null;
// ?demo&locked opens on the lock screen
const startLocked = typeof location !== "undefined" && new URLSearchParams(location.search).has("locked");
let lock = { set: startLocked, journal: startLocked, app: startLocked, unlocked: !startLocked };

export async function demoCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  const now = Date.now();
  switch (name) {
    case "events":
      return events(args.from as number, args.to as number);
    case "store_get":
      return (saved ??= store());
    case "store_put":
      saved = args.value as typeof saved;
      return null;
    case "settings_get":
      return { aiProvider: "claude", aiModel: "claude-haiku-5-5", aiTitles: false, aiAuto: false, importAw: false, detailDays: 30 };
    case "settings_put":
      return args.value;
    case "status":
      return {
        counts: { window: 41_203, windowOwn: 41_203, windowAw: 0, afk: 3_310, media: 0, browser: 0, ocr: 0, manual: 0, firstOwn: ago(DAYS), lastEvent: now },
        extLastSeen: now, extBrowser: "msedge", import: {}, sensorsSince: ago(0), lastSignal: now, paused: false, autostart: true,
        dbPath: "%LOCALAPPDATA%\\Tempro\\tempro.db", encrypted: true, watchdog: { state: "ok" }, crashes: [], crashLog: "%LOCALAPPDATA%\\Tempro\\crash.log",
        awPath: "", agentsPath: "%USERPROFILE%\\.claude\\projects", now,
      };
    case "kv_get":
      return kv.get(args.key as string) ?? null;
    case "kv_put":
      kv.set(args.key as string, args.value);
      return null;
    case "ai_summary":
      await new Promise((r) => setTimeout(r, 600));
      return summary(args.day as Payload);
    case "journal":
      return events(now - 2 * HOUR, now).window.reverse().slice(0, 200).map((w, i) => ({ stream: "window", id: i, ts: w.ts, dur: w.dur, a: w.app, b: w.title, source: "tempro" }));
    case "lock_status":
      return lock;
    case "lock_set":
      lock = { set: args.password !== "", journal: !!args.journal, app: !!args.app, unlocked: true };
      return lock;
    case "lock_unlock":
      lock.unlocked = true;
      return true;
    case "lock_lock":
      lock.unlocked = !lock.set;
      return null;
    case "app_icons":
      return {};
    case "compact_todo":
      return [];
    case "db_key":
      return "demo-mode-has-no-database-key";
    default:
      return null;
  }
}
