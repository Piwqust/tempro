import { ChevronRight, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { appName } from "../engine/context";
import { KIND_COLOR, KIND_LABEL, KINDS, kindOf } from "../engine/rules";
import type { Model, Project, ProjectKind, Segment, Session, StateSpan } from "../engine/types";
import { t } from "../lib/i18n";
import { clock, dur, HOUR, MIN } from "../lib/time";
import { AppIcon } from "./bits";
import { ProjectIcon } from "./ProjectIcon";

type Props = {
  model: Model;
  projects: Map<string, Project>;
  visible: (projectId: string | null, app: string) => boolean;
  selected: string | null;
  onSelect: (sessionId: string | null) => void;
  titles?: Map<string, string>;
};

/** by = time per project inside the block: a kind's row mixes several */
type Block = { start: number; end: number; active: number; ctx: string; app: string; apps: Map<string, number>; by: Map<string | null, number> };
type Lane = { id: string | null; total: number; blocks: Block[]; segs: Segment[] };

/** The timeline reads top-down by kind: one row per kind, its projects under it when open,
 *  the small ones folded into "more". */
type Row =
  | { type: "group"; key: string; kind: ProjectKind | null; lane: Lane; open: boolean; count: number }
  | { type: "project"; key: string; kind: ProjectKind; lane: Lane }
  | { type: "more"; key: string; kind: ProjectKind; lane: Lane; count: number; all: boolean };

const SMALL_MS = 3 * MIN;
const MAX_OPEN = 8;
const OPEN_KEY = "tempro.dtl.open";

function loadOpen(): Record<string, boolean> {
  try {
    return { work: true, ...JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}") };
  } catch {
    return { work: true };
  }
}

const LABEL_W = 196;
/** one density cell, px: the row is drawn as how much of each cell was really spent there */
const CELL_PX = 3;
const MIN_SPAN = 2 * HOUR;

const STATE_NAME: Record<StateSpan["state"], string> = {
  work: t("Работа"),
  watch: t("Видео без ввода"),
  call: t("Созвон"),
  pause: t("Пауза"),
  away: t("Отошёл"),
  off: t("Нет данных"),
};

function fitRange(model: Model, now: number): [number, number] {
  const first = model.segments[0]?.start;
  if (first == null) return [model.from + 8 * HOUR, model.from + 20 * HOUR];
  const last = Math.max(model.segments.at(-1)!.end, Math.min(now, model.to));
  let a = Math.floor(first / HOUR) * HOUR;
  let b = Math.ceil((last + 10 * MIN) / HOUR) * HOUR;
  if (b - a < 6 * HOUR) b = a + 6 * HOUR;
  return [Math.max(model.from, a), Math.min(model.to, b)];
}

/** Ruler step that keeps labels ~80px apart. */
function tickStep(spanMs: number, widthPx: number): number {
  const steps = [10 * MIN, 15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 3 * HOUR];
  const per = spanMs / Math.max(1, widthPx);
  return steps.find((s) => s / per >= 72) ?? 3 * HOUR;
}

/** Segments of one key (a project, or a whole kind) merged into blocks; gaps narrower than ~3px disappear. */
function lanes(segments: Segment[], pxPerMs: number, keyOf: (s: Segment) => string | null = (s) => s.projectId): Lane[] {
  const by = new Map<string | null, Segment[]>();
  for (const s of segments) {
    const k = keyOf(s);
    const list = by.get(k);
    if (list) list.push(s);
    else by.set(k, [s]);
  }
  // join only what the eye can't separate anyway; a long block must mean long work
  const joinGap = Math.max(45_000, 1.2 / pxPerMs);
  const out: Lane[] = [];
  for (const [id, segs] of by) {
    const blocks: Block[] = [];
    let total = 0;
    for (const s of segs) {
      const d = s.end - s.start;
      total += d;
      const label = s.context || appName(s.app);
      const last = blocks[blocks.length - 1];
      if (last && s.start - last.end <= joinGap) {
        last.end = Math.max(last.end, s.end);
        last.active += d;
        last.apps.set(s.app, (last.apps.get(s.app) ?? 0) + d);
        last.by.set(s.projectId, (last.by.get(s.projectId) ?? 0) + d);
        ctxAdd(last, label, d);
      } else {
        const b: Block = { start: s.start, end: s.end, active: d, ctx: label, app: s.app, apps: new Map([[s.app, d]]), by: new Map([[s.projectId, d]]) };
        ctxAdd(b, label, d);
        blocks.push(b);
      }
    }
    for (const b of blocks) finishCtx(b);
    out.push({ id, total, blocks, segs });
  }
  // biggest project on top; the unassigned rest always last
  return out.sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : b.total - a.total));
}

const ctxTally = new WeakMap<Block, Map<string, { ms: number; app: string }>>();
function ctxAdd(b: Block, label: string, d: number) {
  let m = ctxTally.get(b);
  if (!m) ctxTally.set(b, (m = new Map()));
  const cur = m.get(label);
  m.set(label, { ms: (cur?.ms ?? 0) + d, app: b.app });
}
function finishCtx(b: Block) {
  const m = ctxTally.get(b);
  if (!m) return;
  const top = [...m.entries()].sort((x, y) => y[1].ms - x[1].ms)[0];
  if (top) b.ctx = top[0];
  const app = [...b.apps.entries()].sort((x, y) => y[1] - x[1])[0];
  if (app) b.app = app[0];
}

type Hover = { t: number; x: number; y: number; block?: { b: Block; row: Row } };

const top = (m: Map<string | null, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

export function DayTimeline({ model, projects, visible, selected, onSelect, titles }: Props) {
  const [now, setNow] = useState(Date.now());
  const [range, setRange] = useState<[number, number]>(() => fitRange(model, now));
  const [mode, setMode] = useState<"fit" | "day" | "custom">("fit");
  const [hover, setHover] = useState<Hover | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  // a new day, or new data while following the activity: re-fit
  useEffect(() => {
    if (mode === "fit") setRange(fitRange(model, Date.now()));
    else if (mode === "day") setRange([model.from, model.to]);
  }, [model, mode]);

  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [v0, v1] = range;
  const span = v1 - v0;
  const pxPerMs = width / span;
  const x = useCallback((t: number) => ((t - v0) / span) * 100, [v0, span]);
  /** left/width in %, clipped to the visible window so nothing spills over the labels */
  const pos = (start: number, end: number, minPx = 2): CSSProperties => {
    const a = Math.max(0, x(start));
    const b = Math.min(100, x(end));
    return { left: `${a}%`, width: `max(${minPx}px, ${Math.max(0, b - a)}%)` };
  };
  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return v0 + ((clientX - r.left) / r.width) * span;
  };

  const zoom = useCallback(
    (factor: number, around?: number) => {
      setMode("custom");
      setRange(([a, b]) => {
        const c = around ?? (a + b) / 2;
        let na = c - (c - a) * factor;
        let nb = c + (b - c) * factor;
        if (nb - na < MIN_SPAN) {
          const k = MIN_SPAN / (nb - na);
          na = c - (c - na) * k;
          nb = c + (nb - c) * k;
        }
        const w = Math.min(nb - na, model.to - model.from);
        na = Math.max(model.from, Math.min(na, model.to - w));
        return [na, na + w];
      });
    },
    [model.from, model.to],
  );
  const pan = useCallback(
    (ms: number) => {
      setMode("custom");
      setRange(([a, b]) => {
        const w = b - a;
        const na = Math.max(model.from, Math.min(a + ms, model.to - w));
        return [na, na + w];
      });
    },
    [model.from, model.to],
  );

  // ctrl + wheel zooms around the cursor; shift + wheel or a horizontal swipe pans
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoom(Math.exp(e.deltaY * 0.0022), timeAt(e.clientX));
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        pan(((e.shiftKey ? e.deltaY : e.deltaX) / el.clientWidth) * span);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const step = tickStep(span, width);
  const ticks = useMemo(() => {
    const out: number[] = [];
    const tz = new Date(v0).getTimezoneOffset() * MIN;
    for (let t = Math.ceil((v0 - tz) / step) * step + tz; t <= v1; t += step) out.push(t);
    return out;
  }, [v0, v1, step]);

  const [open, setOpen] = useState<Record<string, boolean>>(loadOpen);
  const [all, setAll] = useState<Record<string, boolean>>({});
  const toggle = (k: string) =>
    setOpen((o) => {
      const next = { ...o, [k]: !o[k] };
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {
        // only a convenience
      }
      return next;
    });

  const rows = useMemo<Row[]>(() => {
    const kindOfSeg = (s: Segment): ProjectKind | null => (s.projectId && projects.has(s.projectId) ? kindOf(projects.get(s.projectId)) : null);
    const perKind = new Map(lanes(model.segments, pxPerMs, (s) => kindOfSeg(s) ?? "none").map((l) => [l.id, l]));
    const perProject = lanes(model.segments, pxPerMs);
    const out: Row[] = [];
    for (const k of [...KINDS, null] as (ProjectKind | null)[]) {
      const lane = perKind.get(k ?? "none");
      if (!lane || lane.total < 30_000) continue;
      const mine = k ? perProject.filter((l) => l.id && projects.has(l.id) && kindOf(projects.get(l.id)) === k) : [];
      const isOpen = !!k && !!open[k];
      out.push({ type: "group", key: k ?? "none", kind: k, lane, open: isOpen, count: mine.length });
      if (!isOpen || !k) continue;
      const showAll = !!all[k];
      const big = showAll ? mine : mine.filter((l, i) => i < MAX_OPEN && l.total >= SMALL_MS);
      for (const l of big) out.push({ type: "project", key: l.id!, kind: k, lane: l });
      const rest = mine.filter((l) => !big.includes(l));
      if (rest.length) {
        const ids = new Set(rest.map((l) => l.id));
        const merged = lanes(model.segments.filter((s) => ids.has(s.projectId)), pxPerMs, () => `more:${k}`)[0];
        out.push({ type: "more", key: `more:${k}`, kind: k, lane: merged, count: rest.length, all: false });
      } else if (showAll && mine.length > MAX_OPEN) {
        out.push({ type: "more", key: `more:${k}`, kind: k, lane: { id: null, total: 0, blocks: [], segs: [] }, count: 0, all: true });
      }
    }
    return out;
  }, [model.segments, pxPerMs, projects, open, all]);

  // share of each cell actually spent in the row: eight minutes spread over a day stay faint
  // instead of turning into a wall of 2-pixel stripes
  const density = useMemo(() => {
    const n = Math.max(1, Math.round(width / CELL_PX));
    const cell = span / n;
    const out = new Map<string, Float32Array>();
    for (const r of rows) {
      const v = new Float32Array(n);
      for (const sg of r.lane.segs) {
        if (sg.end <= v0 || sg.start >= v1 || !visible(sg.projectId, sg.app)) continue;
        const a = Math.max(v0, sg.start);
        const b = Math.min(v1, sg.end);
        for (let i = Math.floor((a - v0) / cell); i < n && v0 + i * cell < b; i++) {
          const c0 = v0 + i * cell;
          v[i] += Math.min(b, c0 + cell) - Math.max(a, c0);
        }
      }
      for (let i = 0; i < n; i++) v[i] = Math.min(1, v[i] / cell);
      out.set(r.key, v);
    }
    return out;
  }, [rows, v0, v1, span, width, visible]);

  const colorOf = (r: Row) =>
    r.type === "project" ? (projects.get(r.lane.id!)?.color ?? "var(--none)") : r.kind ? KIND_COLOR[r.kind] : "var(--none)";
  const nameOf = (r: Row) =>
    r.type === "project" ? (projects.get(r.lane.id!)?.name ?? "") : r.type === "more" ? t("ещё {n}", { n: r.count }) : r.kind ? KIND_LABEL[r.kind] : t("Без проекта");

  // agent spans of one project, merged: Claude Code writes a line every few seconds
  const agentBlocks = useMemo(() => {
    const out: { start: number; end: number; projectId: string | null; folder: string }[] = [];
    for (const a of [...model.agents].sort((p, q) => p.start - q.start)) {
      const last = out.findLast((o) => o.projectId === a.projectId && o.folder === a.folder);
      if (last && a.start - last.end < Math.max(2 * MIN, 3 / pxPerMs)) last.end = Math.max(last.end, a.end);
      else out.push({ start: a.start, end: a.end, projectId: a.projectId, folder: a.folder });
    }
    return out;
  }, [model.agents, pxPerMs]);

  // real input counts only; ActivityWatch history has none, so the row simply isn't there
  const bars = useMemo(() => {
    if (!model.input.length) return null;
    const n = Math.max(1, Math.round(width / 4));
    const size = span / n;
    const v = new Array(n).fill(0);
    for (const m of model.input) {
      const t = m.minute * MIN + 30_000;
      if (t < v0 || t >= v1) continue;
      v[Math.floor((t - v0) / size)] += m.keys + m.clicks * 2 + m.wheel * 0.5 + m.moves * 0.05;
    }
    const max = Math.max(1, ...v);
    return { v: v.map((y) => y / max), size };
  }, [model.input, v0, v1, span, width]);

  const sel = selected ? model.sessions.find((s) => s.id === selected) : undefined;
  const live = now >= model.from && now < model.to;
  const inView = <T extends { start: number; end: number }>(a: T[]) => a.filter((s) => s.end > v0 && s.start < v1);

  const stateAt = (t: number) => model.states.find((s) => t >= s.start && t < s.end);
  const segAt = (t: number) => {
    const segs = model.segments;
    let lo = 0, hi = segs.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (segs[m].end <= t) lo = m + 1;
      else if (segs[m].start > t) hi = m - 1;
      else return segs[m];
    }
    return null;
  };
  const sessionAt = (t: number, projectId: string | null): Session | undefined =>
    model.sessions.find((s) => s.projectId === projectId && t >= s.start && t <= s.end);

  const move = (e: React.PointerEvent, block?: { b: Block; row: Row }) => {
    const r = track.current!.getBoundingClientRect();
    setHover({ t: timeAt(e.clientX), x: e.clientX - r.left, y: e.clientY - r.top, block });
  };

  return (
    <section className="dtl card">
      <header className="dtl-head">
        <span className="dtl-title">{t("День")}</span>
        <div className="segmented segmented-sm">
          <button type="button" data-on={mode === "fit" || undefined} onClick={() => setMode("fit")}>
            {t("Активное время")}
          </button>
          <button type="button" data-on={mode === "day" || undefined} onClick={() => setMode("day")}>
            {t("24 часа")}
          </button>
        </div>
        <div className="dtl-zoom">
          <button type="button" className="icon-btn icon-btn-sm" title={t("Отдалить (Ctrl + колесо)")} onClick={() => zoom(1.5)}>
            <Minus size={15} strokeWidth={1.7} />
          </button>
          <button type="button" className="icon-btn icon-btn-sm" title={t("Приблизить (Ctrl + колесо)")} onClick={() => zoom(1 / 1.5)}>
            <Plus size={15} strokeWidth={1.7} />
          </button>
        </div>
      </header>

      <div className="dtl-grid" style={{ "--label": `${LABEL_W}px` } as CSSProperties}>
        {/* labels */}
        <div className="dtl-labels">
          <div className="dtl-ruler-pad" />
          {rows.map((r) => {
            if (r.type === "group") {
              const can = !!r.kind && r.count > 0;
              return (
                <button
                  key={r.key}
                  type="button"
                  className="dtl-label"
                  data-type="group"
                  data-open={r.open || undefined}
                  data-none={!r.kind || undefined}
                  disabled={!can}
                  onClick={() => can && toggle(r.kind!)}
                  title={can ? (r.open ? t("Свернуть проекты") : t("Показать проекты: {n}", { n: r.count })) : undefined}
                >
                  {can ? <ChevronRight size={13} strokeWidth={2} className="dtl-chev" /> : <span className="dtl-chev" />}
                  <span className="truncate">{nameOf(r)}</span>
                  <span className="dtl-label-num">{dur(r.lane.total)}</span>
                </button>
              );
            }
            if (r.type === "more") {
              return (
                <button key={r.key} type="button" className="dtl-label" data-type="more" onClick={() => setAll((x) => ({ ...x, [r.kind]: !r.all }))}>
                  <span className="truncate">{r.all ? t("свернуть мелкие") : t("ещё {n}", { n: r.count })}</span>
                  {!r.all && <span className="dtl-label-num">{dur(r.lane.total)}</span>}
                </button>
              );
            }
            return (
              <div key={r.key} className="dtl-label" data-type="project">
                <ProjectIcon project={projects.get(r.lane.id!)} size={16} />
                <span className="truncate">{nameOf(r)}</span>
                <span className="dtl-label-num">{dur(r.lane.total)}</span>
              </div>
            );
          })}
          {agentBlocks.length > 0 && (
            <div className="dtl-label dtl-label-sub">
              <span className="truncate">{t("Агенты Claude Code")}</span>
            </div>
          )}
          {bars && (
            <div className="dtl-label dtl-label-sub">
              <span className="truncate">{t("Ввод")}</span>
            </div>
          )}
          <div className="dtl-label dtl-label-sub">
            <span className="truncate">{t("Присутствие")}</span>
          </div>
        </div>

        {/* track */}
        <div
          className="dtl-track"
          ref={track}
          onPointerMove={(e) => move(e)}
          onPointerLeave={() => setHover(null)}
          onClick={() => onSelect(null)}
        >
          <div className="dtl-ruler">
            {/* the red "now" label covers ~40px of the ruler: a tick under it would read as 09:30:00 */}
            {ticks
              .filter((t) => !(live && Math.abs(t - now) * pxPerMs < 40))
              .map((t) => (
                <span key={t} className="dtl-tick" style={{ left: `${x(t)}%` }}>
                  {clock(t)}
                </span>
              ))}
          </div>
          {ticks.map((t) => (
            <span key={`g${t}`} className="dtl-grid-line" style={{ left: `${x(t)}%` }} />
          ))}
          {live && now < v1 && <div className="dtl-future" style={{ left: `${Math.max(0, x(now))}%` }} />}
          {sel && <div className="dtl-sel" style={pos(sel.start, sel.end)} />}

          {rows.map((r) => (
            <div key={r.key} className="dtl-lane" data-type={r.type} data-open={(r.type === "group" && r.open) || undefined} style={{ "--c": colorOf(r) } as CSSProperties}>
              <Density v={density.get(r.key)} />
              {inView(r.lane.blocks).map((b) => {
                const main = top(b.by);
                return (
                  <button
                    key={b.start}
                    type="button"
                    className="dtl-block"
                    data-none={(r.type === "group" && !r.kind) || undefined}
                    data-dim={![...b.apps.keys()].some((a) => [...b.by.keys()].some((id) => visible(id, a))) || undefined}
                    style={pos(b.start, b.end)}
                    onPointerMove={(e) => (e.stopPropagation(), move(e, { b, row: r }))}
                    onClick={(e) => {
                      e.stopPropagation();
                      const s = sessionAt((b.start + b.end) / 2, main);
                      onSelect(s && s.id !== selected ? s.id : null);
                    }}
                  >
                    {r.type !== "more" && (b.end - b.start) * pxPerMs > 90 && b.active / (b.end - b.start) > 0.5 && (
                      <span className="dtl-block-label truncate">{r.type === "group" && b.by.size > 1 ? (projects.get(main ?? "")?.name ?? b.ctx) : b.ctx}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}

          {agentBlocks.length > 0 && (
            <div className="dtl-lane dtl-lane-sub">
              {inView(agentBlocks).map((a) => {
                const p = a.projectId ? projects.get(a.projectId) : undefined;
                return (
                  <span
                    key={`${a.start}-${a.folder}`}
                    className="dtl-agent"
                    style={{ ...pos(a.start, a.end), "--c": p?.color ?? "var(--none)" } as CSSProperties}
                    title={`Claude Code · ${a.folder} · ${clock(a.start)}–${clock(a.end)}`}
                  >
                    {(a.end - a.start) * pxPerMs > 70 && <span className="truncate">{a.folder}</span>}
                  </span>
                );
              })}
            </div>
          )}

          {bars && (
            <div className="dtl-lane dtl-lane-sub dtl-bars">
              <svg viewBox={`0 0 ${bars.v.length} 1`} preserveAspectRatio="none" aria-hidden>
                {bars.v.map((h, i) => (h > 0 ? <rect key={i} x={i + 0.15} width={0.7} y={1 - Math.max(0.06, h)} height={Math.max(0.06, h)} /> : null))}
              </svg>
            </div>
          )}

          <div className="dtl-lane dtl-lane-sub dtl-presence">
            {inView(model.states).map((s) =>
              s.state === "off" ? null : (
                <span key={s.start} className={`dtl-state dtl-state-${s.state}`} style={pos(s.start, s.end, 0)} />
              ),
            )}
          </div>

          {live && now >= v0 && now <= v1 && (
            <div className="dtl-now" style={{ left: `${x(now)}%` }}>
              <span className="dtl-now-label">{clock(now)}</span>
            </div>
          )}
          {hover && <div className="dtl-cursor" style={{ left: hover.x }} />}
          {hover && (
            <HoverCard
              hover={hover}
              width={width}
              head={hover.block ? { name: nameOf(hover.block.row), color: colorOf(hover.block.row), mixed: hover.block.row.type !== "project" } : undefined}
              state={stateAt(hover.t)}
              seg={segAt(hover.t)}
              projects={projects}
              title={hover.block ? titles?.get(sessionAt((hover.block.b.start + hover.block.b.end) / 2, top(hover.block.b.by))?.id ?? "") : undefined}
            />
          )}
        </div>
      </div>

      <footer className="dtl-legend">
        {(["work", "watch", "call", "pause", "away"] as const).map((k) => {
          const ms = k === "work" ? model.active - model.watch - model.call - model.manualMs : k === "watch" ? model.watch : k === "call" ? model.call + model.manualMs : k === "pause" ? model.pause : model.away;
          if (ms < MIN && k !== "work") return null;
          return (
            <span key={k}>
              <i className={`dtl-sw dtl-state-${k}`} />
              {STATE_NAME[k]} <b>{dur(ms)}</b>
            </span>
          );
        })}
        <span className="dtl-legend-hint">{t("Ctrl + колесо — масштаб, Shift + колесо — сдвиг")}</span>
      </footer>
    </section>
  );
}

function Density({ v }: { v?: Float32Array }) {
  if (!v) return null;
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < v.length; i++) {
    if (v[i] <= 0) continue;
    // a run of equally busy cells is one rect
    let j = i;
    const level = Math.round(Math.pow(v[i], 0.6) * 8);
    while (j + 1 < v.length && v[j + 1] > 0 && Math.round(Math.pow(v[j + 1], 0.6) * 8) === level) j++;
    cells.push(<rect key={i} x={i} width={j - i + 1} y={0} height={1} opacity={0.14 + (level / 8) * 0.86} />);
    i = j;
  }
  return (
    <svg className="dtl-density" viewBox={`0 0 ${v.length} 1`} preserveAspectRatio="none" aria-hidden>
      {cells}
    </svg>
  );
}

function HoverCard({ hover, width, head, state, seg, projects, title }: {
  hover: Hover;
  width: number;
  /** mixed: a kind's row or "more", so the card lists the projects inside */
  head?: { name: string; color: string; mixed: boolean };
  state?: StateSpan;
  seg: Segment | null;
  projects: Map<string, Project>;
  title?: string;
}) {
  const b = hover.block?.b;
  const left = Math.min(Math.max(8, hover.x + 14), width - 268);
  const flip = hover.x + 14 + 260 > width;
  const style = { left: flip ? hover.x - 274 : left, top: Math.max(4, hover.y - 10) };
  if (b) {
    const apps = [...b.apps.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3);
    const inside = head?.mixed ? [...b.by.entries()].filter(([id]) => id).sort((x, y) => y[1] - x[1]).slice(0, 4) : [];
    return (
      <div className="dtl-tip" style={style}>
        <div className="dtl-tip-head">
          <span className="dot" style={{ background: head?.color ?? "var(--none)", width: 8, height: 8 }} />
          <b className="truncate">{head?.name ?? t("Без проекта")}</b>
          <span className="dtl-tip-time">
            {clock(b.start)}–{clock(b.end)}
          </span>
        </div>
        {title && <div className="dtl-tip-title">{title}</div>}
        {inside.length > 0 && (
          <div className="dtl-tip-projects">
            {inside.map(([id, ms]) => {
              const p = projects.get(id!);
              return (
                <span key={id}>
                  <ProjectIcon project={p} size={15} />
                  <span className="truncate">{p?.name}</span>
                  <i>{dur(ms)}</i>
                </span>
              );
            })}
          </div>
        )}
        <div className="dtl-tip-ctx truncate">{b.ctx}</div>
        <div className="dtl-tip-apps">
          {apps.map(([a, ms]) => (
            <span key={a}>
              <AppIcon app={a} size={14} /> {appName(a)} <i>{dur(ms)}</i>
            </span>
          ))}
        </div>
        <div className="dtl-tip-foot">
          {b.end - b.start - b.active > 2 * MIN
            ? t("{a} в работе из {b}, остальное — другое или пауза", { a: dur(b.active), b: dur(b.end - b.start) })
            : t("{a} в работе", { a: dur(b.active) })}
        </div>
      </div>
    );
  }
  const p = seg?.projectId ? projects.get(seg.projectId) : undefined;
  return (
    <div className="dtl-tip dtl-tip-small" style={style}>
      <div className="dtl-tip-head">
        <b>{clock(hover.t)}</b>
        <span className="dtl-tip-time">{state ? STATE_NAME[state.state] : t("нет данных")}</span>
      </div>
      {seg && (
        <div className="dtl-tip-ctx">
          <AppIcon app={seg.app} size={14} /> <span className="truncate">{seg.context || appName(seg.app)}</span>
          {p && <ProjectIcon project={p} size={15} />}
        </div>
      )}
    </div>
  );
}
