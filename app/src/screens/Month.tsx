import { ArrowRight, Download } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { useSettings } from "../data/backend";
import { useModel, useProjects } from "../data/useModel";
import { KIND_COLOR, KIND_LABEL, KINDS, kindOf, kindTotals } from "../engine/rules";
import type { Model, Project, ProjectKind } from "../engine/types";
import { saveCsv, sessionsCsv } from "../lib/csv";
import { addDays, addMonths, dayNum, dur, HOUR, monthGen, monthTitle, startOfDay, startOfMonth, startOfWeek, weekday } from "../lib/time";
import { useNav } from "../nav";
import { Kinds, Leisure } from "../ui/Overview";
import { Delta, Num } from "../ui/Stats";
import { useDaySums } from "../data/daysum";
import { highlightFacts, Highlights, Rhythm, rhythmFacts, workByDay } from "./Range";
import { AiSummaryBody } from "../ui/AiSummary";
import type { DaySum } from "../engine/summary";
import { PeriodBar } from "../ui/PeriodBar";
import { Loading, LoadError } from "./states";
import { ProjectIcon } from "../ui/ProjectIcon";

type Day = { day: number; total: number; by: Map<ProjectKind | null, number> };

function perDay(model: Model, from: number, to: number, projects: Map<string, Project>): Day[] {
  const out: Day[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) out.push({ day: d, total: 0, by: new Map() });
  const index = new Map(out.map((d, i) => [d.day, i]));
  for (const s of model.segments) {
    const d = out[index.get(startOfDay(s.start)) ?? -1];
    if (!d) continue;
    const ms = s.end - s.start;
    const k = s.projectId && projects.has(s.projectId) ? kindOf(projects.get(s.projectId)) : null;
    d.total += ms;
    d.by.set(k, (d.by.get(k) ?? 0) + ms);
  }
  return out;
}

/** A month at a glance: for coming back after weeks away and seeing what was done. */
export function Month() {
  const { nav, go } = useNav();
  const from = startOfMonth(nav.day);
  const to = addMonths(from, 1);
  const prevFrom = addMonths(from, -1);
  const isCurrent = Date.now() < to;
  // a month in progress is compared with the same days of the previous one, not with all of it
  const elapsed = isCurrent ? addDays(startOfDay(Date.now()), 1) - from : to - from;
  const prevTo = Math.min(from, prevFrom + elapsed);
  const { model, error, loading } = useModel(from, to, 5 * 60_000);
  const { model: prev } = useModel(prevFrom, prevTo, 5 * 60_000);
  const projects = useProjects();
  const than = isCurrent ? `к 1–${dayNum(prevTo - 1)} ${monthGen(prevFrom)}` : "к прошлому месяцу";

  const days = useMemo(() => (model ? perDay(model, from, to, projects) : []), [model, from, to, projects]);
  const kinds = useMemo(() => (model ? kindTotals(model.byProject, projects) : new Map()), [model, projects]);
  const prevKinds = useMemo(() => (prev ? kindTotals(prev.byProject, projects) : new Map()), [prev, projects]);
  const work = kinds.get("work") ?? 0;
  const leisure = kinds.get("leisure") ?? 0;
  const none = kinds.get(null) ?? 0;
  const { days: sums } = useDaySums(from, to);
  const past = useMemo(() => sums.filter((d) => d.day <= startOfDay(Date.now())), [sums]);
  const workOf = useMemo(() => workByDay(past, projects), [past, projects]);
  const workDays = days.filter((d) => (d.by.get("work") ?? 0) >= 30 * 60_000).length;

  return (
    <>
      <PeriodBar
        gran="month"
        right={
          model && (
            <button
              type="button"
              className="btn btn-ghost-white"
              onClick={() => saveCsv(`tempro-${new Date(from).toISOString().slice(0, 7)}.csv`, sessionsCsv(model.sessions, projects))}
            >
              <Download size={15} /> CSV
            </button>
          )
        }
      />
      <div className="screen">
        {error ? (
          <LoadError error={error} />
        ) : loading || !model ? (
          <Loading />
        ) : (
          <>
            <section className="ov mon-kpis">
              <div className="ov-card ov-main">
                <span className="ov-label">Работа</span>
                <Num ms={work} />
                <span className="ov-sub">
                  {workDays ? `${workDays} рабочих дней · в среднем ${dur(work / workDays)} в день` : "рабочих дней нет"}
                </span>
                <Delta now={work} before={prevKinds.get("work") ?? 0} than={than} />
              </div>
              <div className="ov-card">
                <span className="ov-label">Досуг</span>
                <Num ms={leisure} />
                <span className="ov-sub">{model.active ? `${Math.round((leisure / model.active) * 100)}% времени за компьютером` : "—"}</span>
                <Delta now={leisure} before={prevKinds.get("leisure") ?? 0} than={than} invert />
              </div>
              <div className="ov-card">
                <span className="ov-label">За компьютером</span>
                <Num ms={model.active} />
                <span className="ov-sub">видео без ввода {dur(model.watch)} · созвоны {dur(model.call)}</span>
              </div>
              <button type="button" className="ov-card ov-sorted" onClick={() => go({ screen: "unsorted" })} disabled={none < 60_000}>
                <span className="ov-label">Без проекта</span>
                <Num ms={none} />
                <span className="ov-sub">
                  {none >= 60_000 ? (
                    <>
                      разобрать <ArrowRight size={13} />
                    </>
                  ) : (
                    "всё разобрано"
                  )}
                </span>
              </button>
            </section>

            <MonthDays days={days} onOpen={(d) => go({ screen: "today", day: d })} />

            <div className="today-grid">
              <div className="mon-main">
                <MonthWeeks days={days} />
                <MonthProjects model={model} prev={prev} projects={projects} onOpen={(id) => go({ screen: "project", projectId: id })} />
                <Rhythm days={past} projects={projects} />
                <MonthSummary model={model} prev={prev} projects={projects} from={from} days={past} />
              </div>
              <div className="today-side">
                <Highlights days={past} workOf={workOf} totals={model.byProject} prevTotals={prev?.byProject ?? new Map()} projects={projects} />
                <Kinds totals={model.byProject} projects={projects} active={[]} onPick={() => {}} />
                <Leisure model={model} projects={projects} limit={5} />
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function MonthDays({ days, onOpen }: { days: Day[]; onOpen: (day: number) => void }) {
  const max = Math.max(6 * HOUR, ...days.map((d) => d.total));
  const today = startOfDay(Date.now());
  return (
    <section className="card mon-days">
      <header className="card-head">
        <span>По дням</span>
        <span className="mon-legend">
          {KINDS.map((k) => (
            <span key={k}>
              <i style={{ background: KIND_COLOR[k] }} />
              {KIND_LABEL[k]}
            </span>
          ))}
        </span>
      </header>
      <div className="mon-strip" style={{ "--n": days.length } as CSSProperties}>
        {days.map((d) => {
          const wd = new Date(d.day).getDay();
          const parts = KINDS.map((k) => [k, d.by.get(k) ?? 0] as const).filter(([, ms]) => ms > 0);
          const none = d.by.get(null) ?? 0;
          const tip = [...parts.map(([k, ms]) => `${KIND_LABEL[k]} ${dur(ms)}`), none ? `без проекта ${dur(none)}` : ""].filter(Boolean).join(" · ");
          return (
            <button
              key={d.day}
              type="button"
              className="mon-day"
              data-ctx-day={d.day}
              data-weekend={wd === 0 || wd === 6 || undefined}
              data-today={d.day === today || undefined}
              data-future={d.day > today || undefined}
              data-week={wd === 1 || undefined}
              title={d.total ? `${weekday(d.day)} ${dayNum(d.day)}: ${tip}` : undefined}
              onClick={() => d.day <= today && onOpen(d.day)}
            >
              <span className="mon-bar">
                <span className="mon-fill" style={{ height: `${(d.total / max) * 100}%` }}>
                  {parts.map(([k, ms]) => (
                    <span key={k} style={{ flexGrow: ms, background: KIND_COLOR[k] }} />
                  ))}
                  {none > 0 && <span className="mon-none" style={{ flexGrow: none }} />}
                </span>
              </span>
              <span className="mon-num">{dayNum(d.day)}</span>
              <span className="mon-wd">{weekday(d.day)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function MonthWeeks({ days }: { days: Day[] }) {
  const weeks = useMemo(() => {
    const m = new Map<number, Day[]>();
    for (const d of days) {
      const w = startOfWeek(d.day);
      m.set(w, [...(m.get(w) ?? []), d]);
    }
    const today = startOfDay(Date.now());
    return [...m.entries()].filter(([, ds]) => ds[0].day <= today).map(([w, ds]) => {
      const by = new Map<ProjectKind | null, number>();
      for (const d of ds) for (const [k, ms] of d.by) by.set(k, (by.get(k) ?? 0) + ms);
      return { w, first: ds[0].day, last: ds.at(-1)!.day, by, total: ds.reduce((n, d) => n + d.total, 0) };
    });
  }, [days]);
  const max = Math.max(HOUR, ...weeks.map((w) => w.total));
  return (
    <section className="card mon-weeks">
      <header className="card-head">
        <span>По неделям</span>
      </header>
      {weeks.map((w) => (
        <div key={w.w} className="mon-week">
          <span className="mon-week-range">
            {dayNum(w.first)}–{dayNum(w.last)}
          </span>
          <span className="mon-week-bar">
            <span style={{ width: `${(w.total / max) * 100}%` }}>
              {KINDS.map((k) => {
                const ms = w.by.get(k) ?? 0;
                return ms > 0 ? <i key={k} style={{ flexGrow: ms, background: KIND_COLOR[k] }} /> : null;
              })}
              {(w.by.get(null) ?? 0) > 0 && <i className="mon-none" style={{ flexGrow: w.by.get(null) }} />}
            </span>
          </span>
          <span className="mon-week-work">
            <b>{dur(w.by.get("work") ?? 0)}</b> работы
          </span>
          <span className="mon-week-rest">досуг {dur(w.by.get("leisure") ?? 0)}</span>
        </div>
      ))}
    </section>
  );
}

function MonthProjects({ model, prev, projects, onOpen }: { model: Model; prev: Model | null; projects: Map<string, Project>; onOpen: (id: string) => void }) {
  const [kind, setKind] = useState<ProjectKind>("work");
  const [all, setAll] = useState(false);
  const LIMIT = 12;
  const rows = [...model.byProject.entries()]
    .filter((e): e is [string, number] => !!e[0] && projects.has(e[0]) && kindOf(projects.get(e[0])) === kind && e[1] >= 5 * 60_000)
    .sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] ?? 1;
  // a month before the first records compares with nothing: every project would be "new"
  const compare = !!prev && prev.active >= 10 * HOUR;
  // projects that were there last month and vanished this one
  const gone = prev
    ? [...prev.byProject.entries()].filter(([id, ms]) => id && projects.has(id) && kindOf(projects.get(id)) === kind && ms >= HOUR && !model.byProject.get(id)).length
    : 0;
  return (
    <section className="card mon-projects">
      <header className="card-head">
        <span>Проекты</span>
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
      {rows.length === 0 && <div className="empty">За этот месяц здесь ничего</div>}
      {(all ? rows : rows.slice(0, LIMIT)).map(([id, ms]) => {
        const p = projects.get(id)!;
        const before = prev?.byProject.get(id) ?? 0;
        const diff = ms - before;
        return (
          <button key={id} type="button" className="mon-prow" data-ctx-project={id} onClick={() => onOpen(id)}>
            <ProjectIcon project={p} size={20} />
            <span className="truncate">{p.name}</span>
            <span className="mon-pbar">
              <i style={{ width: `${(ms / max) * 100}%`, background: p.color }} />
            </span>
            <b>{dur(ms)}</b>
            <span className="mon-pdiff" data-tone={!compare ? undefined : before < 30 * 60_000 ? "new" : diff >= 0 ? "up" : "down"}>
              {!compare ? "" : before < 30 * 60_000 ? "новый" : Math.abs(diff) < 30 * 60_000 ? "≈" : `${diff > 0 ? "+" : "−"}${dur(Math.abs(diff))}`}
            </span>
          </button>
        );
      })}
      {rows.length > LIMIT && (
        <button type="button" className="mon-gone rg-more" onClick={() => setAll((a) => !a)}>
          {all ? "Свернуть" : `Ещё ${rows.length - LIMIT}: ${dur(rows.slice(LIMIT).reduce((n, [, ms]) => n + ms, 0))}`}
        </button>
      )}
      {gone > 0 && <div className="mon-gone">в прошлом месяце были ещё {gone}, в этом их нет</div>}
    </section>
  );
}

function MonthSummary({ model, prev, projects, from, days }: { model: Model; prev: Model | null; projects: Map<string, Project>; from: number; days: DaySum[] }) {
  const { settings, available } = useSettings();
  if (!available || settings.aiProvider === "none" || model.active < HOUR) return null;
  const h = (ms: number) => +(ms / HOUR).toFixed(1);

  const payload = () => {
    const kinds = (m: Model) => Object.fromEntries([...kindTotals(m.byProject, projects)].map(([k, ms]) => [k ? KIND_LABEL[k] : "Без проекта", h(ms)]));
    const longest = [...model.sessions].sort((a, b) => b.active - a.active)[0];
    return {
      period: "месяц",
      date: monthTitle(from),
      activeHours: h(model.active),
      byKind: kinds(model),
      previousMonthByKind: prev && prev.active >= 10 * HOUR ? kinds(prev) : null,
      byProject: [...model.byProject.entries()]
        .filter(([id]) => id)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([id, ms]) => ({ name: projects.get(id!)?.name, kind: KIND_LABEL[kindOf(projects.get(id!))], hours: h(ms), previousMonth: h(prev?.byProject.get(id) ?? 0) })),
      ...rhythmFacts(days, projects),
      highlights: {
        ...highlightFacts(days, projects),
        longestSession: longest ? { title: longest.label, project: projects.get(longest.projectId ?? "")?.name ?? null, hours: h(longest.active), date: new Date(longest.start).toLocaleDateString("ru-RU") } : null,
      },
    };
  };

  return (
    <section className="card mon-ai">
      <AiSummaryBody id={`month:${from}`} payload={payload} empty="Claude напишет, на что ушёл месяц и что изменилось" />
    </section>
  );
}
