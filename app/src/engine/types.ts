/** project is set once the row's detail was compacted away: the title is empty and the project
 *  the rules gave it then is kept ("" = none); video keeps whether it was a video. */
export type RawWindow = { ts: number; dur: number; app: string; title: string; project?: string; video?: boolean };
/** kind: input (active) | idle | lock | sleep. ActivityWatch history has only input/idle. */
export type RawAfk = { ts: number; dur: number; afk: boolean; kind?: string };
export type RawMedia = { ts: number; dur: number; kind: "audio" | "mic"; app: string };
export type RawBrowser = { ts: number; dur: number; url: string; title: string; browser: string; playing: boolean; audible: boolean };
export type RawOcr = { ts: number; app: string; title: string; text: string };
export type RawAgent = { start: number; end: number; cwd: string; session: string; entry: string };
export type RawInput = { minute: number; keys: number; clicks: number; wheel: number; moves: number };

export type ManualKind = "meeting" | "call" | "break" | "focus" | "other";
export type Manual = { id: string; start: number; end: number; kind: ManualKind; projectId: string | null; note: string };

export type RawEvents = {
  window: RawWindow[];
  afk: RawAfk[];
  media?: RawMedia[];
  browser?: RawBrowser[];
  ocr?: RawOcr[];
  agent?: RawAgent[];
  manual?: Manual[];
  input?: RawInput[];
};

/** work = paid or own projects; leisure = videos, streams, games; personal = family, friends, errands, health;
 *  system = neither: the OS, setup, VPN, file juggling */
export type ProjectKind = "work" | "leisure" | "personal" | "system";
/** icon: a name from engine/icons.ts ICONS; absent means "pick automatically" */
export type Project = { id: string; name: string; color: string; archived?: boolean; rate?: number; kind?: ProjectKind; icon?: string };

/** any = title, document, address, folder and screen text together */
export type RuleField = "app" | "title" | "context" | "url" | "path" | "any";
export type Rule = {
  id: string;
  projectId: string;
  field: RuleField;
  op: "contains" | "equals";
  value: string;
  /** default rules ship with the app; user rules come from corrections and win over defaults */
  source: "default" | "user" | "ai";
  created: number;
  /** a broad rule ("any YouTube tab", "Discord") that only takes what no project keyword claimed */
  fallback?: boolean;
};

/** work = input; watch = video in front, no input; call = microphone in use;
 *  pause = a short silence; away = long silence, lock or sleep; off = tracker had no data */
export type State = "work" | "watch" | "call" | "pause" | "away";

export type SegmentState = "work" | "watch" | "call" | "manual";

export type Segment = {
  start: number;
  end: number;
  app: string;
  title: string;
  context: string;
  url?: string;
  path?: string;
  screen?: string;
  projectId: string | null;
  state: SegmentState;
  /** set when a focus timer or a manual answer decided the project */
  manual?: boolean;
};

export type Session = {
  id: string;
  start: number;
  end: number;
  /** counted time, ms; can be smaller than end-start because of short interruptions */
  active: number;
  projectId: string | null;
  label: string;
  app: string;
  /** most-used apps first */
  apps: string[];
  watch: number;
  call: number;
};

export type StateSpan = { start: number; end: number; state: State | "off" };

export type AgentSpan = { start: number; end: number; folder: string; path: string; projectId: string | null; entry: string };

export type Question = { start: number; end: number };

export type Totals = Map<string | null, number>;

export type Model = {
  from: number;
  to: number;
  segments: Segment[];
  sessions: Session[];
  states: StateSpan[];
  agents: AgentSpan[];
  questions: Question[];
  manual: Manual[];
  input: RawInput[];
  byProject: Totals;
  byApp: Map<string, number>;
  /** end of the newest raw window event: tells whether the tracker is alive */
  lastEvent: number;
  /** counted time: work + watch + call + manual */
  active: number;
  watch: number;
  call: number;
  manualMs: number;
  pause: number;
  away: number;
};
