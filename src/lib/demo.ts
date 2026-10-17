// Demo data for the hero heat map, generated in the page like the app's own `?demo` mode:
// a made-up person's seven months, deterministic per date, relative to the visitor's today.
// Nothing here is anyone's real activity, and the page says so next to the figure.

export type Kind = 'work' | 'leisure';
export type Project = { name: string; color: string; kind: Kind; from: number; to: number; weight: number };
export type Block = { p: number; s: number; e: number }; // project index, minutes since midnight
export type PresenceKind = 'work' | 'video' | 'call' | 'pause' | 'away';
export type Presence = { k: PresenceKind; s: number; e: number };
export type Day = {
  t: number; // local midnight, ms
  blocks: Block[];
  presence: Presence[];
  work: number; // hours
  leisure: number;
  first: number; // minutes
  last: number;
  partial: boolean; // today, cut at the current minute
};

// `from`/`to` are days before today; the colours are the app's project palette.
// Orange is left out on purpose: on this site it only means "now".
export const PROJECTS: Project[] = [
  { name: 'Tempro', color: '#16A06A', kind: 'work', from: 70, to: 0, weight: 4 },
  { name: 'Kite Studio', color: '#2F6BFF', kind: 'work', from: 999, to: 0, weight: 2 },
  { name: 'Aurora website', color: '#0E9FA8', kind: 'work', from: 120, to: 0, weight: 2.5 },
  { name: 'Nimbus App', color: '#8B5CF6', kind: 'work', from: 999, to: 45, weight: 3 },
  { name: 'Design & motion', color: '#E5408A', kind: 'work', from: 999, to: 0, weight: 0.7 },
  { name: 'AI chats', color: '#C28400', kind: 'work', from: 999, to: 0, weight: 0.8 },
  { name: 'Video', color: '#6366F1', kind: 'leisure', from: 999, to: 0, weight: 1 },
  { name: 'Games', color: '#E5484D', kind: 'leisure', from: 999, to: 0, weight: 1 },
];
const VIDEO = 6;
const GAMES = 7;

/** Days of history before today: the made-up person installed Tempro this long ago. */
export const INSTALLED_DAYS_AGO = 214;

const DAY_MS = 86_400_000;
const hm = (h: number, m = 0) => h * 60 + m;

// The hero day, written by hand so the first frame is a full, readable day
// (the same shape as the Day screen in the README).
const HERO: Block[] = [
  { p: 0, s: hm(10, 16), e: hm(11, 52) },
  { p: 0, s: hm(11, 56), e: hm(13, 31) },
  { p: 2, s: hm(13, 31), e: hm(13, 36) },
  { p: 0, s: hm(15, 2), e: hm(16, 20) },
  { p: 2, s: hm(16, 20), e: hm(16, 27) },
  { p: 0, s: hm(16, 42), e: hm(17, 5) },
  { p: 1, s: hm(17, 10), e: hm(18, 5) },
  { p: 1, s: hm(18, 12), e: hm(18, 41) },
  { p: 0, s: hm(18, 45), e: hm(19, 5) },
  { p: 1, s: hm(19, 5), e: hm(19, 35) },
  { p: 4, s: hm(19, 35), e: hm(19, 41) },
  { p: VIDEO, s: hm(20, 5), e: hm(20, 50) },
  { p: GAMES, s: hm(21, 20), e: hm(22, 35) },
  { p: GAMES, s: hm(22, 41), e: hm(23, 13) },
];
const HERO_CALLS: [number, number][] = [[hm(17, 40), hm(18, 5)]];

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

export const midnight = (d: Date | number) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
};
export const addDays = (t: number, n: number) => {
  const x = new Date(t);
  x.setDate(x.getDate() + n);
  return x.getTime();
};
const daysBetween = (a: number, b: number) => Math.round((b - a) / DAY_MS);

function pick(r: () => number, items: number[]) {
  const total = items.reduce((s, i) => s + PROJECTS[i].weight, 0);
  let x = r() * total;
  for (const i of items) if ((x -= PROJECTS[i].weight) <= 0) return i;
  return items[items.length - 1];
}

function generate(t: number, ago: number): Block[] {
  const r = rng(Math.floor(t / DAY_MS) * 2654435761);
  const dow = new Date(t).getDay(); // 0 = Sunday
  const weekend = dow === 0 || dow === 6;
  if (r() < (weekend ? 0.55 : 0.06)) return []; // a day off
  const active = PROJECTS.map((_, i) => i).filter((i) => PROJECTS[i].kind === 'work' && ago <= PROJECTS[i].from && ago >= PROJECTS[i].to);
  const blocks: Block[] = [];
  let m = hm(9, 20) + Math.floor(r() * 100);
  const goal = (weekend ? 50 + r() * 140 : 230 + r() * 260) * (ago > 170 ? 0.7 : 1);
  const lunch = hm(13, 0) + Math.floor(r() * 60);
  let done = 0;
  let lunched = false;
  while (done < goal && m < hm(21, 30)) {
    const p = pick(r, active);
    const len = Math.min(goal - done, 18 + Math.floor(r() * (PROJECTS[p].weight > 2 ? 100 : 40)));
    blocks.push({ p, s: m, e: m + len });
    done += len;
    m += len + 3 + Math.floor(r() * 18);
    if (!lunched && m > lunch) { m += 40 + Math.floor(r() * 35); lunched = true; }
  }
  if (r() < 0.75) {
    let e = Math.max(m + 20, hm(19, 30) + Math.floor(r() * 90));
    const n = 1 + Math.floor(r() * 2);
    for (let i = 0; i < n && e < hm(23, 40); i++) {
      const len = 25 + Math.floor(r() * 80);
      blocks.push({ p: r() < 0.5 ? VIDEO : GAMES, s: e, e: Math.min(e + len, hm(23, 55)) });
      e += len + 10 + Math.floor(r() * 30);
    }
  }
  return blocks;
}

function presenceOf(blocks: Block[], calls: [number, number][] = []): Presence[] {
  const out: Presence[] = [];
  const sorted = [...blocks].sort((a, b) => a.s - b.s);
  sorted.forEach((b, i) => {
    const prev = sorted[i - 1];
    if (prev && b.s > prev.e) out.push({ k: b.s - prev.e < 15 ? 'pause' : 'away', s: prev.e, e: b.s });
    if (b.p === VIDEO) out.push({ k: 'video', s: b.s, e: b.e });
    else {
      // a call inside a block splits it
      let s = b.s;
      for (const [cs, ce] of calls) {
        if (ce <= b.s || cs >= b.e) continue;
        if (cs > s) out.push({ k: 'work', s, e: cs });
        out.push({ k: 'call', s: Math.max(cs, b.s), e: Math.min(ce, b.e) });
        s = Math.min(ce, b.e);
      }
      if (s < b.e) out.push({ k: 'work', s, e: b.e });
    }
  });
  return out;
}

function clip<T extends { s: number; e: number }>(items: T[], until: number): T[] {
  return items.filter((x) => x.s < until).map((x) => ({ ...x, e: Math.min(x.e, until) }));
}

export type Demo = {
  today: number;
  focus: number; // the day the hero opens on
  live: boolean; // focus is today and still recording
  nowMin: number;
  day: (t: number) => Day | null; // null = before install or in the future
};

/** Build the demo around a clock. Before 17:00 the hero shows yesterday, so the first frame is a full day. */
export function makeDemo(now = new Date()): Demo {
  const today = midnight(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const live = nowMin >= hm(17);
  const focus = live ? today : addDays(today, -1);
  const cache = new Map<number, Day | null>();
  const day = (t: number) => {
    if (cache.has(t)) return cache.get(t)!;
    const ago = daysBetween(t, today);
    let d: Day | null = null;
    if (ago >= 0 && ago <= INSTALLED_DAYS_AGO) {
      const isFocus = t === focus;
      let blocks = isFocus ? HERO : generate(t, ago);
      let presence = presenceOf(blocks, isFocus ? HERO_CALLS : []);
      const partial = t === today;
      if (partial) { blocks = clip(blocks, nowMin); presence = clip(presence, nowMin); }
      const mins = (k: Kind) => blocks.filter((b) => PROJECTS[b.p].kind === k).reduce((s, b) => s + b.e - b.s, 0);
      d = {
        t, blocks, presence, partial,
        work: mins('work') / 60,
        leisure: mins('leisure') / 60,
        first: blocks.length ? Math.min(...blocks.map((b) => b.s)) : 0,
        last: blocks.length ? Math.max(...blocks.map((b) => b.e)) : 0,
      };
    }
    cache.set(t, d);
    return d;
  };
  return { today, focus, live, nowMin, day };
}

/** Work minutes per project for a set of days, biggest first. */
export function byProject(days: (Day | null)[]) {
  const m = new Map<number, number>();
  for (const d of days) for (const b of d?.blocks ?? []) m.set(b.p, (m.get(b.p) ?? 0) + b.e - b.s);
  return [...m.entries()].filter(([p]) => PROJECTS[p].kind === 'work').sort((a, b) => b[1] - a[1]);
}

export const fmtHours = (h: number) => (h >= 100 ? Math.round(h).toString() : h >= 10 ? Math.round(h).toString() : (Math.round(h * 10) / 10).toString());
export const fmtClock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;

/** The hero day's presence track, for the five-states section (same day as the hero). */
export const heroPresence = () => presenceOf(HERO, HERO_CALLS);
