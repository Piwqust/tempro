import { Download } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { SHORT_SESSION_MS } from "../engine/compute";
import { KIND_COLOR, KIND_LABEL, KINDS, kindOf, kindTotals } from "../engine/rules";
import { useModel, useProjects } from "../data/useModel";
import type { Model, Project, ProjectKind } from "../engine/types";
import { addDays, dayNum, dur, HOUR, startOfDay, startOfWeek, weekday } from "../lib/time";
import { saveCsv, sessionsCsv } from "../lib/csv";
import { useNav } from "../nav";
import { FilterBar, useFilter } from "../ui/FilterBar";
import { Breakdown, Kinds, Leisure } from "../ui/Overview";
import { SessionList } from "../ui/SessionList";
import { PeriodBar } from "../ui/PeriodBar";
import { Delta } from "../ui/Stats";
import { useDaySums } from "../data/daysum";
import { previous } from "../lib/period";
import { Loading, LoadError } from "./states";

export function Week() {
  const { nav, go } = useNav();
  const from = startOfWeek(nav.day);
  const to = addDays(from, 7);
  const { model, error, loading } = useModel(from, to);
  const projects = useProjects();
  const visible = useFilter();
  const filtered = nav.projectFilter.length > 0 || nav.appFilter.length > 0;
  const [selected, setSelected] = useState<string | null>(null);

  const sessions = model?.sessions.filter((s) => (filtered || s.active >= SHORT_SESSION_MS) && s.apps.some((a) => visible(s.projectId, a))) ?? [];
  const totals = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of model?.segments ?? []) {
      if (!visible(s.projectId, s.app)) continue;
      const d = startOfDay(s.start);
      m.set(d, (m.get(d) ?? 0) + (s.end - s.start));
    }
    return m;
  }, [model, visible]);
  const dayTotal = (d: number) => totals.get(d) ?? 0;
  const work = model ? (kindTotals(model.byProject, projects).get("work") ?? 0) : 0;
  // the week before, cut to as many days as this one has had
  const prev = previous("week", from, to);
  const { days: prevDays } = useDaySums(prev.from, prev.to);
  const prevWork = prevDays.reduce((n, d) => n + (kindTotals(d.byProject, projects).get("work") ?? 0), 0);
  const toggleProject = (id: string) =>
    go({ projectFilter: nav.projectFilter.length === 1 && nav.projectFilter[0] === id ? [] : [id] });

  return (
    <>
      <PeriodBar
        gran="week"
        right={
          model && (
            <button type="button" className="btn btn-ghost-white" onClick={() => saveCsv(`tempro-${new Date(from).toISOString().slice(0, 10)}.csv`, sessionsCsv(sessions, projects))}>
              <Download size={15} /> CSV
            </button>
          )
        }
      />
      <FilterBar
        model={model}
        right={
          model && (
            <span className="summary">
              <b>{dur(work)}</b> работы
              <Delta now={work} before={prevWork} than={prev.partial ? "к тем же дням прошлой недели" : "к прошлой неделе"} />
              <span className="summary-sep" />в среднем {dur(work / Math.max(1, Math.min(7, Math.ceil((Math.min(Date.now(), to) - from) / (24 * HOUR)))))} в день
              <span className="summary-sep" />всего за компьютером {dur(model.active)}
            </span>
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
            <WeekStrip model={model} from={from} projects={projects} visible={visible} onOpen={(d) => go({ screen: "today", day: d })} />
            <div className="today-grid">
              <section className="card today-sessions">
                <header className="card-head">
                  <span>Сессии</span>
                  <span className="muted">{sessions.length}</span>
                </header>
                <SessionList sessions={sessions} projects={projects} selected={selected} onSelect={setSelected} grouped dayTotal={dayTotal} empty="За неделю нет активности" />
              </section>
              <div className="today-side">
                <Kinds totals={model.byProject} projects={projects} active={nav.projectFilter} onPick={(ids) => go({ projectFilter: ids })} />
                <Breakdown totals={model.byProject} projects={projects} active={nav.projectFilter} onToggle={toggleProject} title="Проекты за неделю" />
                <Leisure model={model} projects={projects} limit={5} />
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function WeekStrip({ model, from, projects, visible, onOpen }: { model: Model; from: number; projects: Map<string, Project>; visible: (p: string | null, app: string) => boolean; onOpen: (day: number) => void }) {
  const days = useMemo(() => {
    // a day is a stack of kinds, work at the bottom: dozens of project colours read as noise
    const out = Array.from({ length: 7 }, (_, i) => ({ day: addDays(from, i), total: 0, by: new Map<ProjectKind | null, number>() }));
    for (const s of model.segments) {
      if (!visible(s.projectId, s.app)) continue;
      const i = Math.round((startOfDay(s.start) - from) / (24 * HOUR));
      const d = out[i];
      if (!d) continue;
      const ms = s.end - s.start;
      const k = s.projectId && projects.has(s.projectId) ? kindOf(projects.get(s.projectId)) : null;
      d.total += ms;
      d.by.set(k, (d.by.get(k) ?? 0) + ms);
    }
    return out;
  }, [model, from, visible, projects]);

  const max = Math.max(4 * HOUR, ...days.map((d) => d.total));
  const today = startOfDay(Date.now());

  return (
    <section className="week card">
      {days.map((d) => {
        // column-reverse: the first kind sits at the bottom
        const parts = KINDS.map((k) => [k, d.by.get(k) ?? 0] as const).filter(([, ms]) => ms > 0);
        const none = d.by.get(null) ?? 0;
        const work = d.by.get("work") ?? 0;
        return (
          <button type="button" key={d.day} className="week-day" data-ctx-day={d.day} data-today={d.day === today || undefined} data-future={d.day > today || undefined} onClick={() => onOpen(d.day)}>
            <span className="week-head">
              <span className="day-wd">{weekday(d.day)}</span>
              <span className="week-num">{dayNum(d.day)}</span>
            </span>
            <span className="week-bar">
              <span className="week-fill" style={{ height: `${(d.total / max) * 100}%` }}>
                {parts.map(([k, ms]) => (
                  <span key={k} className="week-seg" style={{ flexGrow: ms, "--c": KIND_COLOR[k] } as CSSProperties} title={`${KIND_LABEL[k]}: ${dur(ms)}`} />
                ))}
                {none > 0 && <span className="week-seg week-seg-none" style={{ flexGrow: none }} title={`Без проекта: ${dur(none)}`} />}
              </span>
            </span>
            <span className="week-total">
              {d.total ? (
                <>
                  <b>{dur(work)}</b> работы
                  <span className="week-all">из {dur(d.total)}</span>
                </>
              ) : (
                "—"
              )}
            </span>
          </button>
        );
      })}
    </section>
  );
}
