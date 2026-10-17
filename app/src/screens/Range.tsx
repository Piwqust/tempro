import { ArrowRight, Download } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { useSettings } from "../data/backend";
import { useDaySums } from "../data/daysum";
import { useProjects } from "../data/useModel";
import { KIND_COLOR, KIND_LABEL, KINDS, kindOf, kindTotals } from "../engine/rules";
import type { DaySum } from "../engine/summary";
import type { Project, ProjectKind } from "../engine/types";
import { saveCsv } from "../lib/csv";
import { monthShort, period, periodTitle, previous, type Gran } from "../lib/period";
import { locale, num, pl, t } from "../lib/i18n";
import { addDays, addMonths, dayMonth, dayNum, dur, HOUR, monthTitle, startOfDay, startOfMonth, startOfWeek, weekdayDate } from "../lib/time";
import { useNav } from "../nav";
import { Kinds } from "../ui/Overview";
import { PeriodBar } from "../ui/PeriodBar";
import { AiSummaryBody } from "../ui/AiSummary";
import { Delta, Num } from "../ui/Stats";
import { Loading, LoadError } from "./states";
import { ProjectIcon } from "../ui/ProjectIcon";

type Totals = Map<string | null, number>;
type Metric = "work" | "leisure" | "all";

const WORKDAY_MS = 30 * 60_000;
const METRIC_LABEL: Record<Metric, string> = { work: t("Работа"), leisure: t("Досуг"), all: t("Всё время") };
const METRIC_COLOR: Record<Metric, string> = { work: KIND_COLOR.work, leisure: KIND_COLOR.leisure, all: "var(--ink)" };

export function workByDay(days: DaySum[], projects: Map<string, Project>): Map<number, number> {
  const m = new Map<number, number>();
  for (const d of days) m.set(d.day, kindTotals(d.byProject, projects).get("work") ?? 0);
  return m;
}

function sum(days: DaySum[]): Totals {
  const m: Totals = new Map();
  for (const d of days) for (const [id, ms] of d.byProject) m.set(id, (m.get(id) ?? 0) + ms);
  return m;
}

/** 3 months or a year at a glance: built from day summaries, never from a year of raw events. */
export function Range({ gran }: { gran: Gran }) {
  const { nav, go } = useNav();
  const { from, to } = period(gran, nav.day);
  const prev = previous(gran, from, to);
  const { days, loading, progress, error } = useDaySums(from, to);
  const { days: prevDays } = useDaySums(prev.from, prev.to);
  const projects = useProjects();
  const today = startOfDay(Date.now());

  const totals = useMemo(() => sum(days), [days]);
  const prevTotals = useMemo(() => sum(prevDays), [prevDays]);
  const kinds = useMemo(() => kindTotals(totals, projects), [totals, projects]);
  const prevKinds = useMemo(() => kindTotals(prevTotals, projects), [prevTotals, projects]);
  const workOf = useMemo(() => workByDay(days, projects), [days, projects]);

  const active = days.reduce((n, d) => n + d.active, 0);
  const work = kinds.get("work") ?? 0;
  const leisure = kinds.get("leisure") ?? 0;
  const none = kinds.get(null) ?? 0;
  const past = days.filter((d) => d.day <= today);
  const recorded = past.filter((d) => d.active >= 5 * 60_000).length;
  const workDays = past.filter((d) => (workOf.get(d.day) ?? 0) >= WORKDAY_MS).length;
  const than = gran === "year" ? (prev.partial ? t("к тем же дням прошлого года") : t("к прошлому году")) : prev.partial ? t("к тем же дням предыдущих 3 месяцев") : t("к предыдущим 3 месяцам");
  const name = gran === "year" ? "год" : "3 месяца";

  const csv = () => {
    const ids = [...totals.keys()].filter((id): id is string => !!id && projects.has(id));
    const head = [t("Дата"), t("За компьютером, ч"), ...ids.map((id) => projects.get(id)!.name), t("Без проекта")];
    const h = (ms: number) => num((ms / HOUR).toFixed(2));
    const rows = past.map((d) => [new Date(d.day).toLocaleDateString(locale()), h(d.active), ...ids.map((id) => h(d.byProject.get(id) ?? 0)), h(d.byProject.get(null) ?? 0)]);
    saveCsv(`tempro-${gran}-${new Date(from).toISOString().slice(0, 7)}.csv`, [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n"));
  };

  return (
    <>
      <PeriodBar
        gran={gran}
        right={
          !loading && (
            <button type="button" className="btn btn-ghost-white" onClick={csv} title={t("Часы по дням и проектам")}>
              <Download size={15} /> CSV
            </button>
          )
        }
      />
      <div className="screen" data-busy={(!loading && progress < 1) || undefined}>
        {error ? (
          <LoadError error={error} />
        ) : loading ? (
          <Loading />
        ) : (
          <>
            {progress < 1 && (
              <div className="rg-progress">
                <i style={{ transform: `scaleX(${progress})` }} />
                <span>{t("Считаю месяцы: {pct}%", { pct: Math.round(progress * 100) })}</span>
              </div>
            )}
            <section className="ov mon-kpis">
              <div className="ov-card ov-main">
                <span className="ov-label">{t("Работа")}</span>
                <Num ms={work} />
                <span className="ov-sub">{workDays ? t("{n} {days} · в среднем {avg}", { n: workDays, days: pl(workDays, ["рабочий день", "рабочих дня", "рабочих дней"], ["working day", "working days"]), avg: dur(work / workDays) }) : t("рабочих дней нет")}</span>
                <Delta now={work} before={prevKinds.get("work") ?? 0} than={than} />
              </div>
              <div className="ov-card">
                <span className="ov-label">{t("Досуг")}</span>
                <Num ms={leisure} />
                <span className="ov-sub">{active ? t("{pct}% времени за компьютером", { pct: Math.round((leisure / active) * 100) }) : "—"}</span>
                <Delta now={leisure} before={prevKinds.get("leisure") ?? 0} than={than} invert />
              </div>
              <div className="ov-card">
                <span className="ov-label">{t("За компьютером")}</span>
                <Num ms={active} />
                <span className="ov-sub">
                  {recorded
                    ? t("{n} {days} с записью из {total} · {avg} в день", { n: recorded, days: pl(recorded, ["день", "дня", "дней"], ["day", "days"]), total: past.length, avg: dur(active / recorded) })
                    : t("{n} {days} с записью из {total}", { n: recorded, days: pl(recorded, ["день", "дня", "дней"], ["day", "days"]), total: past.length })}
                </span>
              </div>
              <button type="button" className="ov-card ov-sorted" onClick={() => go({ screen: "unsorted" })} disabled={none < 60_000}>
                <span className="ov-label">{t("Без проекта")}</span>
                <Num ms={none} />
                <span className="ov-sub">
                  {none >= 60_000 ? (
                    <>
                      {t("разобрать")} <ArrowRight size={13} />
                    </>
                  ) : (
                    t("всё разобрано")
                  )}
                </span>
              </button>
            </section>

            {recorded === 0 ? (
              <div className="card rg-empty">{t("За этот период записей нет. Tempro и ActivityWatch тогда не работали.")}</div>
            ) : (
              <>
                <Heatmap gran={gran} days={days} projects={projects} onOpen={(d) => go({ screen: "today", day: d })} />
                <Bars gran={gran} days={days} projects={projects} from={from} to={to} busy={progress < 1} onOpen={(g, d) => go({ screen: g === "month" ? "month" : "week", day: d })} />
                <div className="today-grid">
                  <div className="mon-main">
                    <RangeProjects gran={gran} days={days} totals={totals} prevTotals={prevTotals} projects={projects} from={from} to={to} onOpen={(id) => go({ screen: "project", projectId: id })} />
                    <Rhythm days={past} projects={projects} />
                  </div>
                  <div className="today-side">
                    <Highlights days={past} workOf={workOf} totals={totals} prevTotals={prevTotals} projects={projects} />
                    <Kinds totals={totals} projects={projects} active={[]} onPick={() => {}} />
                    <RangeSummary name={name} title={periodTitle(gran, from, to)} totals={totals} prevTotals={prevTotals} projects={projects} active={active} days={past} />
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

function metricOf(d: DaySum, m: Metric, projects: Map<string, Project>): number {
  if (m === "all") return d.active;
  return kindTotals(d.byProject, projects).get(m) ?? 0;
}

/** GitHub-style calendar: a column per week, Monday on top. Days with no record at all are
 *  outlined, not grey: "the computer was off" and "no work" are different answers. */
function Heatmap({ gran, days, projects, onOpen }: { gran: Gran; days: DaySum[]; projects: Map<string, Project>; onOpen: (day: number) => void }) {
  const [metric, setMetric] = useState<Metric>("work");
  const [tip, setTip] = useState<{ d: DaySum; x: number; y: number } | null>(null);
  const today = startOfDay(Date.now());
  const weeks = useMemo(() => {
    const out: (DaySum | null)[][] = [];
    if (!days.length) return out;
    const lead = (new Date(days[0].day).getDay() + 6) % 7;
    const cells: (DaySum | null)[] = [...Array<null>(lead).fill(null), ...days];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [days]);
  // three months read better as three calendars with dates than as a strip of 13 weeks
  const months = useMemo(() => {
    if (gran !== "quarter" || !days.length) return null;
    const by = new Map<number, DaySum[]>();
    for (const d of days) {
      const m = startOfMonth(d.day);
      by.set(m, [...(by.get(m) ?? []), d]);
    }
    return [...by.entries()].map(([start, ds]) => ({ start, cells: [...Array<null>((new Date(start).getDay() + 6) % 7).fill(null), ...ds] }));
  }, [gran, days]);
  const values = days.map((d) => metricOf(d, metric, projects));
  const max = Math.max(HOUR, ...values);
  // levels by share of the busiest day, in quarters
  const level = (ms: number) => (ms < 60_000 ? 0 : Math.max(1, Math.ceil((ms / max) * 4)));
  const cell = (d: DaySum, num: boolean) => (
    <button
      key={d.day}
      type="button"
      className="rg-cell"
      data-ctx-day={d.day}
      data-off={(d.day <= today && d.active < 60_000) || undefined}
      data-future={d.day > today || undefined}
      data-today={d.day === today || undefined}
      style={{ "--l": level(metricOf(d, metric, projects)), "--c": METRIC_COLOR[metric] } as CSSProperties}
      onPointerEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setTip({ d, x: r.left + r.width / 2, y: r.top });
      }}
      onClick={() => d.day <= today && onOpen(d.day)}
    >
      {num ? dayNum(d.day) : null}
    </button>
  );

  return (
    <section className="card rg-heat">
      <header className="card-head">
        <span>{t("Календарь")}</span>
        <div className="card-head-right">
          <span className="rg-scale">
            {t("меньше")}
            {[0, 1, 2, 3, 4].map((l) => (
              <i key={l} style={{ "--l": l, "--c": METRIC_COLOR[metric] } as CSSProperties} />
            ))}
            {t("больше")}
          </span>
          <div className="segmented segmented-sm">
            {(Object.keys(METRIC_LABEL) as Metric[]).map((m) => (
              <button key={m} type="button" data-on={m === metric || undefined} onClick={() => setMetric(m)}>
                {METRIC_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
      </header>
      <div className="rg-heat-body" onPointerLeave={() => setTip(null)}>
        {months ? (
          <div className="rg-months">
            {months.map((m) => (
              <div key={m.start} className="rg-month">
                <span className="rg-month-name">{monthTitle(m.start)}</span>
                <div className="rg-month-grid">
                  {WD_SHORT.map((w) => (
                    <span key={w} className="rg-month-wd">
                      {w}
                    </span>
                  ))}
                  {m.cells.map((d, j) => (d ? cell(d, true) : <span key={`e${j}`} />))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rg-heat-grid" style={{ "--weeks": weeks.length } as CSSProperties}>
            <span />
            {WD_SHORT.map((w, i) => (i % 2 === 0 ? w : "")).map((w, i) => (
              <span key={i} className="rg-heat-wd">
                {w}
              </span>
            ))}
            {weeks.flatMap((w, i) => {
              const first = w.find((d) => d && dayNum(d.day) === 1);
              return [
                <span key={`m${i}`} className="rg-heat-month">
                  {first ? monthShort(first.day) : ""}
                </span>,
                ...w.map((d, j) => (d ? cell(d, false) : <span key={`e${i}-${j}`} />)),
              ];
            })}
          </div>
        )}
      </div>
      {tip && <DayTip d={tip.d} x={tip.x} y={tip.y} projects={projects} />}
    </section>
  );
}

function DayTip({ d, x, y, projects }: { d: DaySum; x: number; y: number; projects: Map<string, Project> }) {
  const k = kindTotals(d.byProject, projects);
  const top = [...d.byProject.entries()]
    .filter((e): e is [string, number] => !!e[0] && projects.has(e[0]) && e[1] >= 5 * 60_000)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const date = weekdayDate(d.day);
  return (
    <div className="rg-tip" style={{ left: x, top: y }}>
      <b>{date}</b>
      {d.active < 60_000 ? (
        <span className="muted">{d.day > Date.now() ? t("ещё впереди") : t("записей нет")}</span>
      ) : (
        <>
          <span className="rg-tip-kinds">
            {KINDS.map((kk) => (k.get(kk) ?? 0) >= 60_000 && (
              <span key={kk}>
                <i style={{ background: KIND_COLOR[kk] }} />
                {KIND_LABEL[kk]} {dur(k.get(kk)!)}
              </span>
            ))}
          </span>
          {top.map(([id, ms]) => (
            <span key={id} className="rg-tip-row">
              <i style={{ background: projects.get(id)!.color }} />
              <span className="truncate">{projects.get(id)!.name}</span>
              <span>{dur(ms)}</span>
            </span>
          ))}
          <span className="muted">{t("всего {d}", { d: dur(d.active) })}</span>
        </>
      )}
    </div>
  );
}

type Bucket = { start: number; end: number; by: Map<ProjectKind | null, number>; total: number };

/** Weeks for 3 months, months for a year: Toggl's rule of scaling the bar to the range. */
function buckets(gran: Gran, days: DaySum[], projects: Map<string, Project>, from: number, to: number): Bucket[] {
  const starts: number[] = [];
  if (gran === "year") for (let m = from; m < to; m = addMonths(m, 1)) starts.push(m);
  else for (let w = startOfWeek(from); w < to; w = addDays(w, 7)) starts.push(w);
  const out = starts.map((s, i) => ({ start: s, end: starts[i + 1] ?? to, by: new Map<ProjectKind | null, number>(), total: 0 }));
  let i = 0;
  for (const d of days) {
    while (i < out.length - 1 && d.day >= out[i].end) i++;
    const b = out[i];
    for (const [k, ms] of kindTotals(d.byProject, projects)) b.by.set(k, (b.by.get(k) ?? 0) + ms);
    b.total += d.active;
  }
  return out;
}

function Bars({ gran, days, projects, from, to, busy, onOpen }: { gran: Gran; days: DaySum[]; projects: Map<string, Project>; from: number; to: number; busy: boolean; onOpen: (g: Gran, day: number) => void }) {
  const list = useMemo(() => buckets(gran, days, projects, from, to), [gran, days, projects, from, to]);
  const now = Date.now();
  const max = Math.max(HOUR, ...list.map((b) => b.total));
  const done = list.filter((b) => b.end <= now && b.total > 0);
  const avg = done.length ? done.reduce((n, b) => n + (b.by.get("work") ?? 0), 0) / done.length : 0;
  return (
    <section className="card rg-bars">
      <header className="card-head">
        <span>{gran === "year" ? t("По месяцам") : t("По неделям")}</span>
        {avg > 0 && (
          <span className="muted">
            {gran === "year" ? t("в среднем {d} работы за месяц", { d: dur(avg) }) : t("в среднем {d} работы за неделю", { d: dur(avg) })}
          </span>
        )}
        <span className="mon-legend card-head-right">
          {KINDS.map((k) => (
            <span key={k}>
              <i style={{ background: KIND_COLOR[k] }} />
              {KIND_LABEL[k]}
            </span>
          ))}
        </span>
      </header>
      {/* months arrive one by one and each new one can change the scale: the bars wait for the last
          month and then grow once, instead of jumping on every arrival */}
      <div className="rg-bars-row" data-busy={busy || undefined} style={{ "--n": list.length } as CSSProperties}>
        {list.map((b, i) => {
          const future = b.start > now;
          const work = b.by.get("work") ?? 0;
          const label = gran === "year" ? monthShort(b.start) : `${dayNum(Math.max(b.start, from))}.${String(new Date(Math.max(b.start, from)).getMonth() + 1).padStart(2, "0")}`;
          return (
            <button
              key={b.start}
              type="button"
              className="rg-bar"
              disabled={future}
              data-now={(b.start <= now && now < b.end) || undefined}
              onClick={() => onOpen(gran === "year" ? "month" : "week", Math.min(b.start, startOfDay(now)))}
              title={[...KINDS.map((k) => ((b.by.get(k) ?? 0) >= 60_000 ? `${KIND_LABEL[k]} ${dur(b.by.get(k)!)}` : "")), (b.by.get(null) ?? 0) >= 60_000 ? t("без проекта {d}", { d: dur(b.by.get(null)!) }) : ""].filter(Boolean).join(" · ")}
            >
              <span className="rg-bar-val">{work >= 60_000 ? dur(work) : ""}</span>
              <span className="rg-bar-track">
                <span className="rg-bar-fill" style={{ height: busy ? 0 : `${(b.total / max) * 100}%`, "--i": i } as CSSProperties}>
                  {KINDS.map((k) => ((b.by.get(k) ?? 0) > 0 ? <i key={k} style={{ flexGrow: b.by.get(k), background: KIND_COLOR[k] }} /> : null))}
                  {(b.by.get(null) ?? 0) > 0 && <i className="mon-none" style={{ flexGrow: b.by.get(null) }} />}
                </span>
              </span>
              <span className="rg-bar-label">{label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function RangeProjects({ gran, days, totals, prevTotals, projects, from, to, onOpen }: {
  gran: Gran;
  days: DaySum[];
  totals: Totals;
  prevTotals: Totals;
  projects: Map<string, Project>;
  from: number;
  to: number;
  onOpen: (id: string) => void;
}) {
  const [kind, setKind] = useState<ProjectKind>("work");
  const [all, setAll] = useState(false);
  const rows = [...totals.entries()]
    .filter((e): e is [string, number] => !!e[0] && projects.has(e[0]) && kindOf(projects.get(e[0])) === kind && e[1] >= 10 * 60_000)
    .sort((a, b) => b[1] - a[1]);
  const kindTotal = rows.reduce((n, [, ms]) => n + ms, 0);
  // a period before the first records compares with nothing: every project would be "new"
  const compare = [...prevTotals.values()].reduce((n, ms) => n + ms, 0) >= 10 * HOUR;
  const LIMIT = 12;
  const shown = all ? rows : rows.slice(0, LIMIT);

  // per project, time in each month (year) or week (3 months), for the sparkline
  const spark = useMemo(() => {
    const starts: number[] = [];
    if (gran === "year") for (let m = from; m < to; m = addMonths(m, 1)) starts.push(m);
    else for (let w = startOfWeek(from); w < to; w = addDays(w, 7)) starts.push(w);
    const m = new Map<string, number[]>();
    for (const d of days) {
      const i = gran === "year" ? new Date(d.day).getMonth() - new Date(from).getMonth() + 12 * (new Date(d.day).getFullYear() - new Date(from).getFullYear()) : Math.floor((startOfWeek(d.day) - startOfWeek(from)) / (7 * 86_400_000) + 0.5);
      for (const [id, ms] of d.byProject) {
        if (!id) continue;
        let a = m.get(id);
        if (!a) m.set(id, (a = new Array(starts.length).fill(0)));
        if (a[i] !== undefined) a[i] += ms;
      }
    }
    return m;
  }, [gran, days, from, to]);

  return (
    <section className="card mon-projects">
      <header className="card-head">
        <span>{t("Проекты")}</span>
        <span className="muted">{rows.length}</span>
        <div className="card-head-right">
          <div className="segmented segmented-sm">
            {KINDS.map((k) => (
              <button key={k} type="button" data-on={k === kind || undefined} onClick={() => setKind(k)}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
      </header>
      {rows.length === 0 && <div className="empty">{t("За этот период здесь ничего")}</div>}
      {shown.map(([id, ms]) => {
        const p = projects.get(id)!;
        const before = prevTotals.get(id) ?? 0;
        const diff = ms - before;
        const s = spark.get(id) ?? [];
        const tone = !compare ? undefined : before < 30 * 60_000 ? "new" : diff >= 0 ? "up" : "down";
        const smax = Math.max(1, ...s);
        return (
          <button key={id} type="button" className="mon-prow rg-prow" data-ctx-project={id} onClick={() => onOpen(id)}>
            <ProjectIcon project={p} size={20} />
            <span className="truncate">{p.name}</span>
            <span className="rg-spark" title={gran === "year" ? t("по месяцам") : t("по неделям")}>
              {s.map((v, i) => (
                <i key={i} style={{ height: `${Math.max(v ? 8 : 0, (v / smax) * 100)}%`, background: p.color }} />
              ))}
            </span>
            <span className="rg-share">{kindTotal ? `${Math.round((ms / kindTotal) * 100)}%` : ""}</span>
            <b>{dur(ms)}</b>
            <span className="mon-pdiff" data-tone={tone}>
              {!compare ? "" : before < 30 * 60_000 ? t("новый") : Math.abs(diff) < 30 * 60_000 ? "≈" : `${diff > 0 ? "+" : "−"}${dur(Math.abs(diff))}`}
            </span>
          </button>
        );
      })}
      {rows.length > LIMIT && (
        <button type="button" className="mon-gone rg-more" onClick={() => setAll((a) => !a)}>
          {all ? t("Свернуть") : t("Ещё {n}: {d}", { n: rows.length - LIMIT, d: dur(rows.slice(LIMIT).reduce((n, [, ms]) => n + ms, 0)) })}
        </button>
      )}
    </section>
  );
}

const WD_FULL = [t("понедельник"), t("вторник"), t("среда"), t("четверг"), t("пятница"), t("суббота"), t("воскресенье")];
const WD_SHORT = [t("пн"), t("вт"), t("ср"), t("чт"), t("пт"), t("сб"), t("вс")];

/** When the work happens: the average weekday, and a week of hours. */
export function Rhythm({ days, projects }: { days: DaySum[]; projects: Map<string, Project> }) {
  const [metric, setMetric] = useState<Exclude<Metric, "all">>("work");
  const { grid, byWd, peak, best } = useMemo(() => {
    const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const sumWd = new Array(7).fill(0);
    const count = new Array(7).fill(0);
    for (const d of days) {
      const wd = (new Date(d.day).getDay() + 6) % 7;
      count[wd]++;
      const hrs = d.hours[metric];
      if (hrs) hrs.forEach((ms, h) => (grid[wd][h] += ms));
      sumWd[wd] += metricOf(d, metric, projects);
    }
    const byWd = sumWd.map((ms, i) => (count[i] ? ms / count[i] : 0));
    // the four hours in a row that held the most, over all days
    const byHour = Array.from({ length: 24 }, (_, h) => grid.reduce((n, r) => n + r[h], 0));
    let peak = 0;
    let at = -1;
    for (let h = 0; h <= 20; h++) {
      const s = byHour[h] + byHour[h + 1] + byHour[h + 2] + byHour[h + 3];
      if (s > peak) (peak = s), (at = h);
    }
    const best = byWd.indexOf(Math.max(...byWd));
    return { grid: grid.map((r, i) => r.map((ms) => (count[i] ? ms / count[i] : 0))), byWd, peak: at, best };
  }, [days, metric, projects]);
  const cmax = Math.max(1, ...grid.flat());
  const wmax = Math.max(1, ...byWd);
  const has = byWd.some((v) => v >= 60_000);
  const c = KIND_COLOR[metric];

  return (
    <section className="card rg-rhythm">
      <header className="card-head">
        <span>{t("Когда")}</span>
        {has && (
          <span className="muted">
            {metric === "work"
              ? t("больше всего работы с {a} до {b} · {wd}", { a: peak, b: peak + 4, wd: WD_FULL[best] })
              : t("больше всего досуга с {a} до {b} · {wd}", { a: peak, b: peak + 4, wd: WD_FULL[best] })}
          </span>
        )}
        <div className="card-head-right">
          <div className="segmented segmented-sm">
            {(["work", "leisure"] as const).map((m) => (
              <button key={m} type="button" data-on={m === metric || undefined} onClick={() => setMetric(m)}>
                {METRIC_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
      </header>
      {!has ? (
        <div className="empty">{t("Нет данных")}</div>
      ) : (
        <div className="rg-rhythm-body">
          <div className="rg-hours">
            {grid.map((row, i) => (
              <div key={i} className="rg-hours-row">
                <span className="rg-hours-wd">{WD_SHORT[i]}</span>
                {row.map((ms, h) => (
                  <i key={h} style={{ "--l": ms < 30_000 ? 0 : Math.max(1, Math.ceil((ms / cmax) * 4)), "--c": c } as CSSProperties} title={t("{wd} {h}:00–{h2}:00 · в среднем {d}", { wd: WD_SHORT[i], h, h2: h + 1, d: dur(ms) })} />
                ))}
              </div>
            ))}
            <div className="rg-hours-row rg-hours-axis">
              <span className="rg-hours-wd" />
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h}>{h % 6 === 0 ? h : ""}</span>
              ))}
            </div>
          </div>
          <div className="rg-wd">
            {byWd.map((ms, i) => (
              <div key={i} className="rg-wd-row" data-best={i === best || undefined}>
                <span>{WD_SHORT[i]}</span>
                <span className="rg-wd-bar">
                  <i style={{ width: `${(ms / wmax) * 100}%`, background: c }} />
                </span>
                <b>{dur(ms)}</b>
              </div>
            ))}
            <span className="rg-wd-note">{t("в среднем за день недели")}</span>
          </div>
        </div>
      )}
    </section>
  );
}

/** What stands out, each linking to where it happened. */
export function Highlights({ days, workOf, totals, prevTotals, projects }: { days: DaySum[]; workOf: Map<number, number>; totals: Totals; prevTotals: Totals; projects: Map<string, Project> }) {
  const { go } = useNav();
  const h = useMemo(() => {
    let bestDay: DaySum | null = null;
    let longest: DaySum["longest"] = null;
    let leisureDay: { d: DaySum; ms: number } | null = null;
    let run = 0;
    let streak = { len: 0, end: 0 };
    const weeks = new Map<number, number>();
    for (const d of days) {
      const w = workOf.get(d.day) ?? 0;
      if (!bestDay || w > (workOf.get(bestDay.day) ?? 0)) bestDay = d;
      if (d.longest && (!longest || d.longest.active > longest.active)) longest = d.longest;
      const l = kindTotals(d.byProject, projects).get("leisure") ?? 0;
      if (!leisureDay || l > leisureDay.ms) leisureDay = { d, ms: l };
      run = w >= WORKDAY_MS ? run + 1 : 0;
      if (run > streak.len) streak = { len: run, end: d.day };
      const wk = startOfWeek(d.day);
      weeks.set(wk, (weeks.get(wk) ?? 0) + w);
    }
    const bestWeek = [...weeks.entries()].sort((a, b) => b[1] - a[1])[0];
    const fresh = [...prevTotals.values()].reduce((n, ms) => n + ms, 0) < 10 * HOUR ? [] : [...totals.entries()]
      .filter((e): e is [string, number] => !!e[0] && projects.has(e[0]) && e[1] >= HOUR && (prevTotals.get(e[0]) ?? 0) < 30 * 60_000 && kindOf(projects.get(e[0])) !== "system")
      .sort((a, b) => b[1] - a[1]);
    return { bestDay, longest, leisureDay, streak, current: run, bestWeek, fresh };
  }, [days, workOf, totals, prevTotals, projects]);

  const live = days.at(-1)?.day === startOfDay(Date.now());
  const items: { label: string; value: string; sub?: string; onClick?: () => void }[] = [];
  if (h.bestDay && (workOf.get(h.bestDay.day) ?? 0) >= HOUR)
    items.push({ label: t("Самый рабочий день"), value: dur(workOf.get(h.bestDay.day)!), sub: weekdayDate(h.bestDay.day), onClick: () => go({ screen: "today", day: h.bestDay!.day }) });
  if (h.bestWeek && h.bestWeek[1] >= HOUR)
    items.push({ label: t("Лучшая неделя"), value: dur(h.bestWeek[1]), sub: `${dayMonth(h.bestWeek[0])} – ${dayMonth(addDays(h.bestWeek[0], 6))}`, onClick: () => go({ screen: "week", day: h.bestWeek![0] }) });
  if (h.longest)
    items.push({
      label: t("Самая длинная сессия"),
      value: dur(h.longest.active),
      sub: [h.longest.projectId ? projects.get(h.longest.projectId)?.name : null, h.longest.label].filter(Boolean)[0] ?? "",
      onClick: () => go({ screen: "today", day: startOfDay(h.longest!.start) }),
    });
  if (h.streak.len >= 2)
    items.push({
      label: t("Дней работы подряд"),
      value: String(h.streak.len),
      // "now" only means something while the period is still running
      sub: !live || h.current < 2 ? t("до {d}", { d: dayMonth(h.streak.end) }) : h.current === h.streak.len ? t("и это сейчас") : t("сейчас {n}", { n: h.current }),
    });
  if (h.fresh.length)
    items.push({ label: h.fresh.length === 1 ? t("Новый проект") : t("Новых проектов: {n}", { n: h.fresh.length }), value: projects.get(h.fresh[0][0])!.name, sub: h.fresh.slice(1, 3).map(([id]) => projects.get(id)!.name).join(", ") || dur(h.fresh[0][1]), onClick: () => go({ screen: "project", projectId: h.fresh[0][0] }) });
  if (h.leisureDay && h.leisureDay.ms >= HOUR)
    items.push({ label: t("Больше всего досуга"), value: dur(h.leisureDay.ms), sub: weekdayDate(h.leisureDay.d.day), onClick: () => go({ screen: "today", day: h.leisureDay!.d.day }) });

  if (!items.length) return null;
  return (
    <section className="card rg-hl">
      <header className="card-head">
        <span>{t("Заметное")}</span>
      </header>
      {items.map((it) =>
        it.onClick ? (
          <button key={it.label} type="button" className="rg-hl-row" onClick={it.onClick}>
            <span className="rg-hl-label">{it.label}</span>
            <b className="truncate">{it.value}</b>
            <span className="rg-hl-sub truncate">{it.sub}</span>
          </button>
        ) : (
          <div key={it.label} className="rg-hl-row">
            <span className="rg-hl-label">{it.label}</span>
            <b>{it.value}</b>
            <span className="rg-hl-sub">{it.sub}</span>
          </div>
        ),
      )}
    </section>
  );
}

/** When the work happens, in words for the AI: busiest four hours, busiest weekday. */
export function rhythmFacts(days: DaySum[], projects: Map<string, Project>) {
  const byHour = new Array(24).fill(0);
  const byWd = new Array(7).fill(0);
  for (const d of days) {
    d.hours.work?.forEach((ms, i) => (byHour[i] += ms));
    byWd[(new Date(d.day).getDay() + 6) % 7] += kindTotals(d.byProject, projects).get("work") ?? 0;
  }
  let at = -1;
  let best = 0;
  for (let i = 0; i <= 20; i++) {
    const s = byHour[i] + byHour[i + 1] + byHour[i + 2] + byHour[i + 3];
    if (s > best) (best = s), (at = i);
  }
  const wd = byWd.indexOf(Math.max(...byWd));
  return { rhythm: best > 0 ? { busiestWorkHours: `${at}:00–${at + 4}:00`, busiestWeekday: WD_FULL[wd] } : null };
}

/** The same things the "Заметное" card shows, as plain facts. */
export function highlightFacts(days: DaySum[], projects: Map<string, Project>) {
  const h = (ms: number) => +(ms / HOUR).toFixed(1);
  const work = workByDay(days, projects);
  let best: DaySum | null = null;
  let run = 0;
  let streak = 0;
  let leisure: { d: DaySum; ms: number } | null = null;
  for (const d of days) {
    const w = work.get(d.day) ?? 0;
    if (!best || w > (work.get(best.day) ?? 0)) best = d;
    run = w >= WORKDAY_MS ? run + 1 : 0;
    streak = Math.max(streak, run);
    const l = kindTotals(d.byProject, projects).get("leisure") ?? 0;
    if (!leisure || l > leisure.ms) leisure = { d, ms: l };
  }
  const date = dayMonth;
  return {
    busiestWorkDay: best && (work.get(best.day) ?? 0) >= HOUR ? { date: date(best.day), workHours: h(work.get(best.day)!) } : null,
    longestWorkStreakDays: streak >= 2 ? streak : null,
    mostLeisureDay: leisure && leisure.ms >= HOUR ? { date: date(leisure.d.day), hours: h(leisure.ms) } : null,
    daysWithRecords: days.filter((d) => d.active >= 5 * 60_000).length,
    workingDays: [...work.values()].filter((ms) => ms >= WORKDAY_MS).length,
  };
}

function RangeSummary({ name, title, totals, prevTotals, projects, active, days }: {
  name: string;
  title: string;
  totals: Totals;
  prevTotals: Totals;
  projects: Map<string, Project>;
  active: number;
  days: DaySum[];
}) {
  const { settings, available } = useSettings();
  if (!available || settings.aiProvider === "none" || active < HOUR) return null;
  const h = (ms: number) => +(ms / HOUR).toFixed(1);
  const compare = [...prevTotals.values()].reduce((n, ms) => n + ms, 0) >= 10 * HOUR;

  const payload = () => {
    const kinds = (m: Totals) => Object.fromEntries([...kindTotals(m, projects)].map(([k, ms]) => [k ? KIND_LABEL[k] : t("Без проекта"), h(ms)]));
    const longest = days.reduce<DaySum["longest"]>((b, d) => (d.longest && (!b || d.longest.active > b.active) ? d.longest : b), null);
    return {
      period: name,
      date: title,
      activeHours: h(active),
      byKind: kinds(totals),
      previousByKind: compare ? kinds(prevTotals) : null,
      byProject: [...totals.entries()]
        .filter(([id]) => id && projects.has(id))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([id, ms]) => ({ name: projects.get(id!)?.name, kind: KIND_LABEL[kindOf(projects.get(id!))], hours: h(ms), previous: compare ? h(prevTotals.get(id) ?? 0) : null })),
      ...rhythmFacts(days, projects),
      highlights: {
        ...highlightFacts(days, projects),
        longestSession: longest ? { title: longest.label, project: projects.get(longest.projectId ?? "")?.name ?? null, hours: h(longest.active), date: new Date(longest.start).toLocaleDateString(locale()) } : null,
      },
    };
  };

  return (
    <section className="card mon-ai">
      <AiSummaryBody id={`${name}:${title}`} payload={payload} empty={t("Claude напишет, на что ушло это время и что изменилось")} />
    </section>
  );
}
