import { describe, expect, test } from "bun:test";
import { compacted, compute, cut, PAUSE_MAX_MS, pinsFor } from "./compute";
import { agentFolder, extractContext } from "./context";
import { compileRules, seedProjects } from "./rules";
import type { Project, RawEvents, Rule } from "./types";

const M = 60_000;
const T0 = Date.UTC(2026, 9, 16, 9, 0, 0);
const at = (min: number) => T0 + min * M;
const win = (min: number, durMin: number, app: string, title: string) => ({ ts: at(min), dur: durMin * 60, app, title });
const afk = (min: number, durMin: number, away: boolean, kind?: string) => ({ ts: at(min), dur: durMin * 60, afk: away, kind });

const projects: Project[] = [
  { id: "p_aurora", name: "aurora", color: "#f00" },
  { id: "p_x", name: "X", color: "#0f0" },
];
const rules: Rule[] = [
  { id: "r1", projectId: "p_aurora", field: "any", op: "contains", value: "aurora", source: "default", created: 0 },
  { id: "r2", projectId: "p_x", field: "path", op: "contains", value: "projx", source: "user", created: 1 },
];
const match = compileRules(rules, projects);
const run = (raw: RawEvents, opts = {}) => compute(raw, T0, T0 + 24 * 60 * M, match, { now: T0 + 23 * 60 * M, ...opts });

describe("states", () => {
  test("short silence is a pause, long silence is away, lock is away", () => {
    const m = run({
      window: [win(0, 60, "Figma.exe", "aurora - Figma")],
      afk: [afk(0, 10, false), afk(10, 3, true), afk(13, 7, false), afk(20, 20, true), afk(40, 10, false), afk(50, 2, true, "lock")],
    });
    const kinds = m.states.filter((s) => s.state !== "off").map((s) => s.state);
    expect(kinds).toEqual(["work", "pause", "work", "away", "work", "away"]);
    expect(m.active).toBe(27 * M);
    expect(m.pause).toBe(3 * M);
  });

  test("video without input counts as watching", () => {
    const m = run({ window: [win(0, 30, "msedge.exe", "Talk - YouTube - Personal - Microsoft​ Edge")], afk: [afk(0, 5, false), afk(5, 25, true)] });
    expect(m.watch).toBe(25 * M);
    expect(m.active).toBe(30 * M);
  });

  test("an app making sound keeps you present", () => {
    const m = run({
      window: [win(0, 20, "vlc2.exe", "movie")],
      afk: [afk(0, 2, false), afk(2, 18, true)],
      media: [{ ts: at(2), dur: 10 * 60, kind: "audio", app: "vlc2.exe" }],
    });
    expect(m.watch).toBe(10 * M);
  });

  test("microphone in use is a call, even without typing", () => {
    const m = run({
      window: [win(0, 40, "Telegram.exe", "Chat")],
      afk: [afk(0, 10, false), afk(10, 30, true)],
      media: [{ ts: at(5), dur: 25 * 60, kind: "mic", app: "Telegram.exe" }],
    });
    expect(m.call).toBe(25 * M);
    expect(m.active).toBe(30 * M);
    expect(m.states.some((s) => s.state === "call")).toBe(true);
  });

  test("locked screen never counts, even with a video title", () => {
    const m = run({ window: [win(0, 30, "msedge.exe", "x - YouTube")], afk: [afk(0, 30, true, "lock")] });
    expect(m.active).toBe(0);
  });

  test("PAUSE_MAX_MS boundary", () => {
    expect(PAUSE_MAX_MS).toBe(5 * M);
  });
});

describe("projects", () => {
  test("rules match title, browser url and agent folder", () => {
    const m = run({
      window: [win(0, 10, "Figma.exe", "aurora — website - Figma"), win(10, 10, "msedge.exe", "Untitled"), win(20, 10, "claude.exe", "Claude")],
      afk: [afk(0, 30, false)],
      browser: [{ ts: at(10), dur: 600, url: "https://www.figma.com/design/KEY/aurora", title: "aurora – Figma", browser: "edge", playing: false, audible: false }],
      agent: [{ start: at(20), end: at(30), cwd: "C:\\Users\\me\\CODE\\projx", session: "s", entry: "claude-desktop" }],
    });
    expect(m.byProject.get("p_aurora")).toBe(20 * M);
    expect(m.byProject.get("p_x")).toBe(10 * M);
    expect(m.agents[0].folder).toBe("projx");
    expect(m.agents[0].projectId).toBe("p_x");
  });

  test("user rules beat default rules", () => {
    const r: Rule[] = [...rules, { id: "u", projectId: "p_x", field: "context", op: "equals", value: "aurora — website", source: "user", created: 5 }];
    const m = compute({ window: [win(0, 10, "Figma.exe", "aurora — website - Figma")], afk: [afk(0, 10, false)] }, T0, T0 + 86_400_000, compileRules(r, projects), { now: at(600) });
    expect(m.byProject.get("p_x")).toBe(10 * M);
  });

  test("screen text feeds 'any' rules", () => {
    const m = run({
      window: [win(0, 10, "ChatGPT.exe", "ChatGPT")],
      afk: [afk(0, 10, false)],
      ocr: [{ ts: at(1), app: "ChatGPT.exe", title: "ChatGPT", text: "draft the aurora landing copy" }],
    });
    expect(m.byProject.get("p_aurora")).toBe(10 * M);
  });

  test("archived projects stop matching", () => {
    const m = compute(
      { window: [win(0, 10, "Figma.exe", "aurora - Figma")], afk: [afk(0, 10, false)] },
      T0, T0 + 86_400_000,
      compileRules(rules, projects.map((p) => ({ ...p, archived: p.id === "p_aurora" }))),
      { now: at(600) },
    );
    expect(m.byProject.get(null)).toBe(10 * M);
  });
});

describe("manual", () => {
  test("a meeting fills the time you were away and asks no question", () => {
    const raw: RawEvents = {
      window: [win(0, 10, "Figma.exe", "x - Figma"), win(70, 10, "Figma.exe", "x - Figma")],
      afk: [afk(0, 10, false), afk(10, 60, true), afk(70, 10, false)],
    };
    expect(run(raw).questions).toHaveLength(1);
    const m = run({ ...raw, manual: [{ id: "m", start: at(10), end: at(70), kind: "meeting", projectId: "p_x", note: "Созвон" }] });
    expect(m.questions).toHaveLength(0);
    expect(m.byProject.get("p_x")).toBe(60 * M);
    expect(m.manualMs).toBe(60 * M);
  });

  test("a break answers the question without adding time", () => {
    const m = run({
      window: [win(0, 10, "a.exe", "x")],
      afk: [afk(0, 10, false), afk(10, 60, true)],
      manual: [{ id: "b", start: at(10), end: at(70), kind: "break", projectId: null, note: "" }],
    });
    expect(m.questions).toHaveLength(0);
    expect(m.active).toBe(10 * M);
  });

  test("focus timer overrides rules inside its span", () => {
    const m = run({
      window: [win(0, 20, "Figma.exe", "aurora - Figma")],
      afk: [afk(0, 20, false)],
      manual: [{ id: "f", start: at(10), end: at(20), kind: "focus", projectId: "p_x", note: "" }],
    });
    expect(m.byProject.get("p_aurora")).toBe(10 * M);
    expect(m.byProject.get("p_x")).toBe(10 * M);
  });
});

describe("sessions", () => {
  test("short detours stay inside one session", () => {
    const m = run({
      window: [win(0, 20, "Figma.exe", "aurora - Figma"), { ts: at(20), dur: 20, app: "Telegram.exe", title: "chat" }, win(20.34, 20, "Figma.exe", "aurora - Figma")],
      afk: [afk(0, 41, false)],
    });
    const aurora = m.sessions.filter((s) => s.projectId === "p_aurora");
    expect(aurora).toHaveLength(1);
  });

  test("a long gap splits sessions", () => {
    const m = run({ window: [win(0, 10, "Figma.exe", "aurora - Figma"), win(30, 10, "Figma.exe", "aurora - Figma")], afk: [afk(0, 10, false), afk(30, 10, false)] });
    expect(m.sessions).toHaveLength(2);
  });
});

describe("helpers", () => {
  test("cut splits a range", () => {
    expect(cut(0, 10, [{ start: 2, end: 4 }, { start: 6, end: 20 }])).toEqual({
      inside: [{ start: 2, end: 4 }, { start: 6, end: 10 }],
      outside: [{ start: 0, end: 2 }, { start: 4, end: 6 }],
    });
  });

  test("contexts", () => {
    expect(extractContext("Figma.exe", "💙 Nimbus - Figma")).toBe("💙 Nimbus");
    expect(extractContext("AfterFX.exe", "Adobe After Effects 2026 - C:\\Users\\me\\Downloads\\NM_intro.aep *")).toBe("Downloads\\NM_intro.aep");
    expect(extractContext("Cursor.exe", "Fix bug - 03Renamefigma - Cursor")).toBe("03Renamefigma");
    expect(extractContext("msedge.exe", "Docs and 18 more pages - Personal - Microsoft\u200b Edge")).toBe("Docs");
    expect(extractContext("Telegram.exe", "\u200eorbit (93517)")).toBe("orbit");
    expect(agentFolder("C:\\Users\\me\\Desktop\\CODE\\Tempro")).toBe("Tempro");
    expect(agentFolder("C:\\Users\\me")).toBe("");
    expect(agentFolder("C:\\Users\\me\\AppData\\Local\\x\\scratch-workspaces\\abc")).toBe("");
  });

  test("seed rules look everywhere", () => {
    expect(seedProjects().rules.every((r) => r.field === "any")).toBe(true);
  });
});

test("telegram titles lose unread counters and bidi marks", () => {
  expect(extractContext("Telegram.exe", "(1) ‎⁨Alex⁩ @ ‎orbit (93846)")).toBe("Alex @ orbit");
});

test("no questions about the night", () => {
  const m = compute(
    { window: [win(0, 10, "a.exe", "x"), win(600, 10, "a.exe", "x")], afk: [afk(0, 10, false), afk(10, 590, true), afk(600, 10, false)] },
    T0, T0 + 86_400_000, match, { now: at(700) },
  );
  expect(m.questions).toHaveLength(0);
});

/** Keyword projects like the ones people make for their clients. */
function starter(): { projects: Project[]; rules: Rule[] } {
  const projects: Project[] = [
    { id: "p_aurora", name: "aurora", color: "#f00" },
    { id: "p_kite", name: "Kite.Studio", color: "#0f0" },
  ];
  const kw = (projectId: string, value: string): Rule => ({ id: `r_${value}`, projectId, field: "any", op: "contains", value, source: "default", created: 0 });
  return { projects, rules: [kw("p_aurora", "aurora"), kw("p_kite", "kite.studio"), kw("p_kite", "maria")] };
}

test("among built-in keywords the first one named wins", () => {
  const { projects: ps, rules: rs } = starter();
  const m = compileRules(rs, ps)({ app: "Figma.exe", title: "🎬 Kite.Studio × aurora.team × maria - Figma", context: "🎬 Kite.Studio × aurora.team × maria" });
  expect(ps.find((p) => p.id === m?.projectId)?.name).toBe("Kite.Studio");
});

test("categories: AW first, built-ins fill the gaps in order", async () => {
  const { compileCategories } = await import("./categories");
  const cat = compileCategories([{ name: ["Comms", "IM"], regex: "Telegram", ignoreCase: false }]);
  expect(cat("Telegram.exe", "Figma chat")).toBe("Общение");
  expect(cat("Figma.exe", "aurora - Figma")).toBe("Работа");
  expect(cat("msedge.exe", "Claude tips - YouTube")).toBe("Медиа");
  expect(cat("deadlock.exe", "Deadlock")).toBe("Медиа");
  expect(cat("notepad.exe", "x")).toBe("Прочее");
});

test("broad fallback rules take only what no keyword claimed", () => {
  const { projects: ps, rules: rs } = starter();
  const video: Project = { id: "p_video", name: "Видео", color: "#000", kind: "leisure" };
  const yt: Rule = { id: "r_yt", projectId: "p_video", field: "title", op: "contains", value: "- youtube", source: "ai", created: 9, fallback: true };
  const m = compileRules([...rs, yt], [...ps, video]);
  expect(m({ app: "msedge.exe", title: "aurora showreel - YouTube", context: "aurora showreel - YouTube" })?.projectId).toBe("p_aurora");
  expect(m({ app: "msedge.exe", title: "Кот - YouTube", context: "Кот - YouTube" })?.projectId).toBe("p_video");
});

test("compacted history keeps every project's time", () => {
  const raw: RawEvents = {
    window: [
      win(0, 600, "Figma.exe", "aurora — website - Figma"),
      win(600, 300, "msedge.exe", "Кот - YouTube - Personal - Microsoft Edge"),
      win(900, 300, "Telegram.exe", "Чат"),
    ],
    afk: [afk(0, 600, false), afk(600, 600, true)],
  };
  const end = T0 + 86_400_000;
  const before = compute(raw, T0, end, match, { now: at(2000) });
  const pins = pinsFor(raw, T0, end, match, at(2000));
  expect(pins.length).toBe(3);
  const after = compute(compacted(raw, pins, end), T0, end, match, { now: at(2000) });
  expect([...after.byProject]).toEqual([...before.byProject]);
  expect(after.watch).toBe(before.watch);
  expect(after.segments.every((s) => s.title === "")).toBe(true);
});
