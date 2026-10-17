import { agentFolder, appName, extractContext, isAgentHost, isBrowser, isVideo, tabContext } from "./context";
import type { Matcher } from "./rules";
import type { AgentSpan, Manual, Model, Question, RawEvents, RawWindow, Segment, SegmentState, Session, State, StateSpan } from "./types";

/** Interruptions shorter than this don't break a session (alt-tab to Telegram and back). */
const ABSORB_MS = 45_000;
/** A pause longer than this ends a session. */
const GAP_MS = 4 * 60_000;
/** Sessions shorter than this are noise in the list unless you filter for them (always counted in totals). */
export const SHORT_SESSION_MS = 90_000;
const MIN_SESSION_MS = 20_000;
/** Silence shorter than this is a pause (thinking, reading); longer is "away". */
export const PAUSE_MAX_MS = 5 * 60_000;
/** Longer absences are sleep or the end of the day: nothing to ask about. */
const QUESTION_MAX_MS = 3 * 3_600_000;
/** OCR text describes the window for a while after it was taken. */
const OCR_REACH_MS = 6 * 60_000;

export type ComputeOptions = {
  now?: number;
  questionMinutes?: number;
  /** called once per raw window row that still has its detail: what the rules made of it */
  onAssign?: (w: RawWindow, projectId: string | null, video: boolean) => void;
};

type Iv = { start: number; end: number };

// ---------- interval helpers ----------

function merge(list: Iv[]): Iv[] {
  const s = [...list].sort((a, b) => a.start - b.start);
  const out: Iv[] = [];
  for (const iv of s) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end + 1000) last.end = Math.max(last.end, iv.end);
    else out.push({ start: iv.start, end: iv.end });
  }
  return out;
}

/** First index whose interval may end after t (intervals sorted, non-overlapping). */
function seek(ivs: Iv[], t: number): number {
  let lo = 0, hi = ivs.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (ivs[m].end <= t) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** Split [start, end) into the parts inside and outside the merged intervals. */
export function cut(start: number, end: number, ivs: Iv[]): { inside: Iv[]; outside: Iv[] } {
  const inside: Iv[] = [];
  const outside: Iv[] = [];
  let t = start;
  for (let i = seek(ivs, start); i < ivs.length && ivs[i].start < end; i++) {
    const a = Math.max(start, ivs[i].start);
    const b = Math.min(end, ivs[i].end);
    if (a > t) outside.push({ start: t, end: a });
    if (b > a) inside.push({ start: a, end: b });
    t = Math.max(t, b);
  }
  if (t < end) outside.push({ start: t, end });
  return { inside, outside };
}

/** The item overlapping [start, end) the most. Items sorted by start. */
function best<T extends Iv>(items: T[], start: number, end: number): T | null {
  let lo = 0, hi = items.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (items[m].start < end) lo = m + 1;
    else hi = m;
  }
  let top: T | null = null;
  let most = 0;
  for (let i = lo - 1; i >= 0 && i >= lo - 64; i--) {
    const o = Math.min(end, items[i].end) - Math.max(start, items[i].start);
    if (o > most) (most = o), (top = items[i]);
  }
  return top;
}

// ---------- AFK into states ----------

type AfkGroup = Iv & { state: "work" | "pause" | "away"; hard: boolean };

function afkGroups(raw: RawEvents, from: number, until: number): AfkGroup[] {
  const spans = raw.afk
    .map((e) => ({ start: Math.max(from, e.ts), end: Math.min(until, e.ts + e.dur * 1000), afk: e.afk, hard: e.kind === "lock" || e.kind === "sleep" }))
    .filter((e) => e.end > e.start)
    .sort((a, b) => a.start - b.start);
  // a silence split across several rows is still one silence
  const groups: (Iv & { afk: boolean; hard: boolean })[] = [];
  for (const s of spans) {
    const last = groups[groups.length - 1];
    if (last && last.afk === s.afk && s.start - last.end < 2000) {
      last.end = Math.max(last.end, s.end);
      last.hard ||= s.hard;
    } else if (last && s.start < last.end) {
      // overlapping rows of different kinds: the later one wins from its start
      last.end = s.start;
      groups.push({ ...s });
    } else groups.push({ ...s });
  }
  return groups
    .filter((g) => g.end > g.start)
    .map((g) => ({
      start: g.start,
      end: g.end,
      hard: g.hard,
      state: !g.afk ? "work" : g.hard || g.end - g.start >= PAUSE_MAX_MS ? "away" : "pause",
    }));
}

// ---------- main ----------

export function compute(raw: RawEvents, from: number, to: number, match: Matcher, opts: ComputeOptions = {}): Model {
  const now = opts.now ?? Date.now();
  const until = Math.min(to, now);
  const groups = afkGroups(raw, from, until);

  const mic = merge((raw.media ?? []).filter((m) => m.kind === "mic").map((m) => ({ start: m.ts, end: m.ts + m.dur * 1000 })));
  const audioByApp = new Map<string, Iv[]>();
  for (const m of raw.media ?? []) {
    if (m.kind !== "audio") continue;
    const k = m.app.toLowerCase();
    audioByApp.set(k, [...(audioByApp.get(k) ?? []), { start: m.ts, end: m.ts + m.dur * 1000 }]);
  }
  for (const [k, v] of audioByApp) audioByApp.set(k, merge(v));

  const browser = (raw.browser ?? []).map((b) => ({ ...b, start: b.ts, end: b.ts + b.dur * 1000 })).sort((a, b) => a.start - b.start);
  const playing = merge(browser.filter((b) => b.playing));
  const agents = [...(raw.agent ?? [])].sort((a, b) => a.start - b.start);
  const ocrByApp = new Map<string, { ts: number; text: string }[]>();
  for (const o of raw.ocr ?? []) {
    const k = o.app.toLowerCase();
    ocrByApp.set(k, [...(ocrByApp.get(k) ?? []), { ts: o.ts, text: o.text }]);
  }

  const cache = new Map<string, string | null>();
  const segments: Segment[] = [];

  // one window row on screen, cut by presence: work, watching or a call
  function emit(
    w: RawWindow,
    ws: number,
    we: number,
    context: string,
    url: string | undefined,
    path: string | undefined,
    screen: string | undefined,
    projectId: string | null,
    video: boolean,
  ) {
    const watchIvs = video ? [{ start: ws, end: we }] : merge([...(audioByApp.get(w.app.toLowerCase()) ?? []), ...(isBrowser(w.app) ? playing : [])]);

    const push = (iv: Iv, state: SegmentState) =>
      segments.push({ start: iv.start, end: iv.end, app: w.app, title: w.title, context, url, path, screen, projectId, state });

    for (let k = seek(groups, ws); k < groups.length && groups[k].start < we; k++) {
      const g = groups[k];
      const s = Math.max(ws, g.start);
      const e = Math.min(we, g.end);
      if (e <= s) continue;
      if (g.hard) continue; // locked or asleep: nothing on screen counts
      const { inside: onCall, outside } = cut(s, e, mic);
      // a microphone in use means a call, with or without typing
      onCall.forEach((iv) => push(iv, "call"));
      if (g.state === "work") outside.forEach((iv) => push(iv, "work"));
      // no input, but a video or sound in front: still here
      else for (const o of outside) cut(o.start, o.end, watchIvs).inside.forEach((iv) => push(iv, "watch"));
    }
  }

  for (const w of raw.window) {
    const ws = Math.max(from, w.ts);
    const we = Math.min(until, w.ts + w.dur * 1000);
    if (we <= ws) continue;

    // a compacted row: no detail left, the project decided back then stands; without one,
    // rules about the program itself (Discord, a game) can still place it
    if (w.project !== undefined) {
      const projectId = w.project || (match({ app: w.app, title: "", context: "" })?.projectId ?? null);
      emit(w, ws, we, "", undefined, undefined, undefined, projectId, w.video ?? false);
      continue;
    }

    // what this window is about, from the strongest source available
    let context = extractContext(w.app, w.title);
    let url: string | undefined;
    let path: string | undefined;
    let screen: string | undefined;
    if (isBrowser(w.app) && browser.length) {
      const b = best(browser, ws, we);
      if (b) (url = b.url), (context = tabContext(b.title, b.url) || context);
    }
    if (isAgentHost(w.app) && agents.length) {
      const a = best(agents, ws, we);
      if (a) {
        path = a.cwd;
        const folder = agentFolder(a.cwd);
        if (folder) context = folder;
      }
    }
    const shots = ocrByApp.get(w.app.toLowerCase());
    if (shots) {
      let near: { ts: number; text: string } | null = null;
      for (const s of shots) {
        if (s.ts >= ws - OCR_REACH_MS && s.ts <= we + 60_000 && (!near || Math.abs(s.ts - ws) < Math.abs(near.ts - ws))) near = s;
      }
      screen = near?.text;
    }

    const key = [w.app, w.title, url, path, screen?.slice(0, 80)].join("\u0000");
    let projectId = cache.get(key);
    if (projectId === undefined) {
      projectId = match({ app: w.app, title: w.title, context, url, path, screen })?.projectId ?? null;
      cache.set(key, projectId);
    }
    const video = isVideo(w.app, w.title);
    opts.onAssign?.(w, projectId, video);
    emit(w, ws, we, context, url, path, screen, projectId, video);
  }
  segments.sort((a, b) => a.start - b.start);

  const manual = (raw.manual ?? []).filter((m) => m.end > from && m.start < to);
  applyManual(segments, manual, from, until);

  const byProject = new Map<string | null, number>();
  const byApp = new Map<string, number>();
  let active = 0, watch = 0, call = 0, manualMs = 0;
  for (const s of segments) {
    const d = s.end - s.start;
    byProject.set(s.projectId, (byProject.get(s.projectId) ?? 0) + d);
    byApp.set(s.app, (byApp.get(s.app) ?? 0) + d);
    active += d;
    if (s.state === "watch") watch += d;
    else if (s.state === "call") call += d;
    else if (s.state === "manual") manualMs += d;
  }

  const states = buildStates(groups, segments, from, until);
  let pause = 0, away = 0;
  for (const s of states) {
    if (s.state === "pause") pause += s.end - s.start;
    else if (s.state === "away") away += s.end - s.start;
  }

  return {
    from,
    to,
    segments,
    sessions: buildSessions(segments),
    states,
    agents: agentLane(agents, from, until, match),
    questions: questions(groups, manual, now, (opts.questionMinutes ?? 15) * 60_000),
    manual,
    input: (raw.input ?? []).filter((i) => i.minute * 60_000 >= from && i.minute * 60_000 < to),
    byProject,
    byApp,
    lastEvent: raw.window.reduce((m, w) => Math.max(m, w.ts + w.dur * 1000), 0),
    active,
    watch,
    call,
    manualMs,
    pause,
    away,
  };
}

/** Focus timers and answers with a project decide the project of everything inside them;
 *  meetings and calls also count the time you were away from the keyboard. */
function applyManual(segments: Segment[], manual: Manual[], from: number, until: number) {
  const deciding = manual.filter((m) => m.projectId && m.kind !== "break");
  if (deciding.length) {
    // split segments at the edges of the deciding spans, so the override is exact to the second
    const edges = deciding.flatMap((d) => [d.start, d.end]);
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const e = edges.find((t) => t > s.start && t < s.end);
      if (e !== undefined) {
        segments.splice(i + 1, 0, { ...s, start: e });
        s.end = e;
      }
    }
    for (const s of segments) {
      const mid = (s.start + s.end) / 2;
      const m = deciding.find((d) => mid >= d.start && mid < d.end);
      if (m) (s.projectId = m.projectId), (s.manual = true);
    }
  }
  const covered = merge(segments);
  const label: Record<string, string> = { meeting: "Встреча", call: "Звонок", other: "Другое" };
  for (const m of manual) {
    if (m.kind === "break" || m.kind === "focus") continue;
    const s = Math.max(from, m.start);
    const e = Math.min(until, m.end);
    if (e <= s) continue;
    const name = m.note || label[m.kind] || "Отметка";
    for (const iv of cut(s, e, covered).outside) {
      segments.push({ start: iv.start, end: iv.end, app: "manual", title: name, context: name, projectId: m.projectId, state: "manual", manual: true });
    }
  }
  segments.sort((a, b) => a.start - b.start);
}

function questions(groups: AfkGroup[], manual: Manual[], now: number, minMs: number): Question[] {
  return groups
    .filter((g) => g.state === "away" && g.end - g.start >= minMs && g.end - g.start <= QUESTION_MAX_MS && g.end <= now - 30_000)
    .filter((g) => !manual.some((m) => m.start < g.end && m.end > g.start))
    .map((g) => ({ start: g.start, end: g.end }));
}

function agentLane(agents: NonNullable<RawEvents["agent"]>, from: number, until: number, match: Matcher): AgentSpan[] {
  const out: AgentSpan[] = [];
  for (const a of agents) {
    const start = Math.max(from, a.start);
    const end = Math.min(until, a.end);
    if (end <= start) continue;
    const folder = agentFolder(a.cwd);
    out.push({
      start,
      end,
      folder: folder || "без папки",
      path: a.cwd,
      entry: a.entry,
      projectId: match({ app: "agent", title: "", context: folder, path: a.cwd })?.projectId ?? null,
    });
  }
  return out;
}

// ---------- sessions ----------

// Unassigned work is one stream: splitting it by app shreds a day into 2-minute pieces
// every time you alt-tab between a chat and a browser.
const sessionKey = (s: Segment) => s.projectId ?? "none";

type Acc = {
  key: string;
  start: number;
  end: number;
  active: number;
  watch: number;
  call: number;
  projectId: string | null;
  ctx: Map<string, number>;
  ctxApp: Map<string, string>;
  apps: Map<string, number>;
};

function buildSessions(segments: Segment[]): Session[] {
  const out: Session[] = [];
  let cur: Acc | null = null;
  let pending: Segment[] = [];

  const open = (s: Segment): Acc => ({
    key: sessionKey(s), start: s.start, end: s.end, active: 0, watch: 0, call: 0, projectId: s.projectId,
    ctx: new Map(), ctxApp: new Map(), apps: new Map(),
  });
  const add = (acc: Acc, s: Segment) => {
    const d = s.end - s.start;
    acc.start = Math.min(acc.start, s.start);
    acc.end = Math.max(acc.end, s.end);
    acc.active += d;
    if (s.state === "watch") acc.watch += d;
    if (s.state === "call" || s.state === "manual") acc.call += d;
    const label = s.context || appName(s.app);
    acc.ctx.set(label, (acc.ctx.get(label) ?? 0) + d);
    acc.ctxApp.set(label, s.app);
    acc.apps.set(s.app, (acc.apps.get(s.app) ?? 0) + d);
  };
  const close = () => {
    if (cur && cur.active >= MIN_SESSION_MS) out.push(finish(cur));
    cur = null;
  };

  for (const s of segments) {
    if (cur && s.start - cur.end > GAP_MS) {
      close();
      pending = [];
    }
    if (!cur) {
      cur = open(s);
      add(cur, s);
      continue;
    }
    if (sessionKey(s) === cur.key) {
      // a short detour between two pieces of the same work stays inside the session span;
      // its time is still counted where it belongs, because totals come from segments
      pending = [];
      add(cur, s);
      continue;
    }
    pending.push(s);
    if (pending.reduce((n, p) => n + (p.end - p.start), 0) > ABSORB_MS) {
      close();
      const next: Acc = open(pending[pending.length - 1]);
      for (const p of pending) if (sessionKey(p) === next.key) add(next, p);
      cur = next;
      pending = [];
    }
  }
  close();
  return out.reverse();
}

function finish(a: Acc): Session {
  const top = <K,>(m: Map<K, number>) => [...m.entries()].sort((x, y) => y[1] - x[1])[0][0];
  const label = top(a.ctx);
  return {
    id: `${a.start}-${a.key}`,
    start: a.start,
    end: a.end,
    active: a.active,
    projectId: a.projectId,
    label,
    // the app that shows the label, so the icon and the title agree
    app: a.ctxApp.get(label) ?? top(a.apps),
    apps: [...a.apps.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k]) => k),
    watch: a.watch,
    call: a.call,
  };
}

// ---------- state lane ----------

function buildStates(groups: AfkGroup[], segments: Segment[], from: number, until: number): StateSpan[] {
  const base: StateSpan[] = [];
  let t = from;
  for (const g of groups) {
    if (g.start > t + 1000) base.push({ start: t, end: g.start, state: "off" });
    base.push({ start: g.start, end: g.end, state: g.state });
    t = Math.max(t, g.end);
  }
  if (until > t + 1000) base.push({ start: t, end: until, state: "off" });

  // calls beat video; both beat whatever the keyboard said
  const callIvs = merge(segments.filter((s) => s.state === "call" || s.state === "manual"));
  const watchIvs = merge(segments.filter((s) => s.state === "watch")).flatMap((w) => cut(w.start, w.end, callIvs).outside);
  const overlays = [
    ...callIvs.map((i) => ({ ...i, state: "call" as State })),
    ...watchIvs.map((i) => ({ ...i, state: "watch" as State })),
  ].sort((a, b) => a.start - b.start);

  const painted: StateSpan[] = [];
  for (const b of base) {
    let c = b.start;
    for (const o of overlays) {
      if (o.end <= c || o.start >= b.end) continue;
      if (o.start > c) painted.push({ start: c, end: o.start, state: b.state });
      painted.push({ start: Math.max(c, o.start), end: Math.min(b.end, o.end), state: o.state });
      c = Math.min(b.end, o.end);
    }
    if (c < b.end) painted.push({ start: c, end: b.end, state: b.state });
  }

  const merged: StateSpan[] = [];
  for (const s of painted) {
    const last = merged[merged.length - 1];
    if (last && last.state === s.state && s.start - last.end < 1000) last.end = s.end;
    else merged.push({ ...s });
  }
  return merged;
}

/** What the rules make of each raw window row starting in [from, to): the project and
 *  whether it was a video. This is what survives when the row's detail is compacted away. */
export function pinsFor(raw: RawEvents, from: number, to: number, match: Matcher, now = Date.now()): [number, string, boolean][] {
  const out: [number, string, boolean][] = [];
  compute(raw, from, to, match, {
    now,
    onAssign: (w, projectId, video) => {
      if (w.ts >= from && w.ts < to) out.push([w.ts, projectId ?? "", video]);
    },
  });
  return out;
}

/** The same events as the database returns them after compaction, for checks and tests. */
export function compacted(raw: RawEvents, pins: [number, string, boolean][], until: number): RawEvents {
  const byTs = new Map(pins.map(([ts, p, v]) => [ts, { p, v }]));
  return {
    ...raw,
    window: raw.window.map((w) => {
      if (w.ts >= until || w.project !== undefined) return w;
      const pin = byTs.get(w.ts);
      return { ...w, title: "", project: pin?.p ?? "", video: pin?.v ?? false };
    }),
    browser: (raw.browser ?? []).map((b) => (b.ts < until ? { ...b, url: "", title: "" } : b)),
    ocr: (raw.ocr ?? []).filter((o) => o.ts >= until),
  };
}
