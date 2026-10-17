import { ArrowRight } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { useSettings } from "../data/backend";
import { appName } from "../engine/context";
import { KIND_COLOR, KIND_LABEL, KINDS, kindOf, kindTotals } from "../engine/rules";
import type { Model, Project, ProjectKind } from "../engine/types";
import { addDays, clock, dur, durParts, HOUR } from "../lib/time";
import { useDaySums } from "../data/daysum";
import { AiSummaryBody } from "./AiSummary";
import { useNav } from "../nav";
import { ProjectIcon } from "./ProjectIcon";

function Num({ ms }: { ms: number }) {
  const [n, u] = durParts(ms);
  return (
    <span className="ov-num">
      {n}
      <small>{u}</small>
    </span>
  );
}

/** The day at a glance: how much, how much of it is sorted, how it split between states. */
export function Hero({ model, projects, day }: { model: Model; projects: Map<string, Project>; day: number }) {
  const { go } = useNav();
  const none = model.byProject.get(null) ?? 0;
  const sorted = model.active ? Math.round(((model.active - none) / model.active) * 100) : 0;
  const first = model.segments[0]?.start;
  const last = model.segments.at(-1)?.end;
  const money = [...model.byProject.entries()].reduce((n, [id, ms]) => n + (id ? ((projects.get(id)?.rate ?? 0) * ms) / HOUR : 0), 0);
  const work = kindTotals(model.byProject, projects).get("work") ?? 0;
  const top = [...model.byProject.entries()]
    .filter(([id, ms]) => id && projects.has(id) && kindOf(projects.get(id)) === "work" && ms >= 60_000)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <section className="ov">
      <div className="ov-card ov-main">
        <span className="ov-label">Работа</span>
        <Num ms={work} />
        <span className="ov-sub">{first && last ? `за компьютером ${dur(model.active)} · ${clock(first)} – ${clock(last)}` : "нет активности"}</span>
      </div>

      <button type="button" className="ov-card ov-sorted" onClick={() => go({ screen: "unsorted" })} disabled={none < 60_000}>
        <span className="ov-label">Разобрано</span>
        <span className="ov-num">
          {sorted}
          <small>%</small>
        </span>
        <span className="ov-meter">
          <i style={{ width: `${sorted}%` }} />
        </span>
        <span className="ov-sub">
          {none >= 60_000 ? (
            <>
              без проекта {dur(none)} <ArrowRight size={13} />
            </>
          ) : (
            "всё по проектам"
          )}
        </span>
      </button>

      <div className="ov-card">
        <span className="ov-label">Больше всего в работе</span>
        {top.length === 0 ? (
          <span className="ov-sub">рабочих проектов за этот день нет</span>
        ) : (
          <div className="ov-top">
            {top.map(([id, ms]) => {
              const p = projects.get(id!)!;
              return (
                <button key={id} type="button" className="ov-top-row" onClick={() => go({ screen: "project", projectId: id! })}>
                  <ProjectIcon project={p} size={18} />
                  <span className="truncate">{p.name}</span>
                  <span className="ov-top-bar">
                    <i style={{ width: `${(ms / top[0][1]) * 100}%`, background: p.color }} />
                  </span>
                  <b>{dur(ms)}</b>
                </button>
              );
            })}
          </div>
        )}
        {money > 0 && <span className="ov-sub">≈ {Math.round(money).toLocaleString("ru-RU")} ₽ по ставкам</span>}
      </div>

      <AiSummary model={model} projects={projects} day={day} />
    </section>
  );
}

function AiSummary({ model, projects, day }: { model: Model; projects: Map<string, Project>; day: number }) {
  const { settings, available } = useSettings();
  const [full, setFull] = useState(false);
  // the usual day to compare with: the last two weeks' working days
  const { days: before } = useDaySums(addDays(day, -14), day);
  if (!available || settings.aiProvider === "none" || model.active < 10 * 60_000) return null;

  const payload = () => {
    const h = (ms: number) => +(ms / HOUR).toFixed(1);
    const m = (ms: number) => Math.round(ms / 60_000);
    const kindOfId = (id: string | null) => (id && projects.has(id) ? kindOf(projects.get(id)) : null);
    const ranked = [...model.byProject.entries()].filter(([id]) => id).sort((a, b) => b[1] - a[1]);
    const ctx = (k: string) => {
      const c = new Map<string, number>();
      for (const s of model.segments) if (kindOfId(s.projectId) === k) c.set(s.context || appName(s.app), (c.get(s.context || appName(s.app)) ?? 0) + (s.end - s.start));
      return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([title, ms]) => ({ title, minutes: m(ms) }));
    };
    const hours = new Array(24).fill(0);
    for (const s of model.segments) if (kindOfId(s.projectId) === "work") hours[new Date(s.start).getHours()] += s.end - s.start;
    const peak = hours.indexOf(Math.max(...hours));
    const sessions = model.sessions.filter((s) => s.active >= 90_000);
    const longest = [...sessions].sort((a, b) => b.active - a.active)[0];
    const workDays = before.map((d) => kindTotals(d.byProject, projects).get("work") ?? 0).filter((ms) => ms >= 30 * 60_000);
    const first = model.segments[0]?.start;
    const last = model.segments.at(-1)?.end;
    return {
      period: "день",
      date: new Date(day).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" }),
      activeHours: h(model.active),
      byKind: Object.fromEntries([...kindTotals(model.byProject, projects)].map(([k, ms]) => [k ? KIND_LABEL[k] : "Без проекта", h(ms)])),
      byProject: ranked.map(([id, ms]) => ({ name: projects.get(id!)?.name, kind: KIND_LABEL[kindOf(projects.get(id!))], hours: h(ms) })),
      workTop: ctx("work"),
      leisureTop: ctx("leisure"),
      rhythm: {
        start: first ? clock(first) : null,
        end: last ? clock(last) : null,
        sessions: sessions.length,
        longestSession: longest ? { title: longest.label, project: projects.get(longest.projectId ?? "")?.name ?? null, minutes: m(longest.active) } : null,
        busiestWorkHour: hours[peak] > 0 ? `${peak}:00–${peak + 1}:00` : null,
        videoWithoutInputHours: h(model.watch),
        callsHours: h(model.call),
      },
      usual: workDays.length >= 3 ? { workHoursOnWorkingDay: h(workDays.reduce((n, x) => n + x, 0) / workDays.length), workingDaysInLast14: workDays.length } : null,
    };
  };

  return (
    <div className="ov-card ov-ai" data-full={full || undefined}>
      <AiSummaryBody id={`day:${day}`} payload={payload} empty="Коротко о дне: главное, ритм, досуг" onFull={setFull} />
    </div>
  );
}

const LIMIT = 10;

/** Projects ranked, with one 100% bar on top: replaces the tall blocks that made "unassigned" look like the main event. */
export function Breakdown({ totals, projects, active, onToggle, title = "Проекты" }: {
  totals: Map<string | null, number>;
  projects: Map<string, Project>;
  active: string[];
  onToggle: (id: string) => void;
  title?: string;
}) {
  const all = [...totals.values()].reduce((a, b) => a + b, 0);
  const rows = [...totals.entries()]
    .filter(([id, ms]) => ms >= 60_000 && (id === null || projects.has(id)))
    .sort((a, b) => (a[0] === null ? 1 : b[0] === null ? -1 : b[1] - a[1]));
  // with dozens of projects the tail goes behind "more"; a selected or unassigned row always stays
  const [open, setOpen] = useState(false);
  const keep = (r: [string | null, number], i: number) => open || i < LIMIT || r[0] === null || active.includes(r[0]);
  const shown = rows.filter(keep);
  const hidden = rows.filter((r, i) => !keep(r, i));
  if (!all) return <section className="card bd"><div className="empty">Нет данных</div></section>;

  return (
    <section className="card bd">
      <header className="card-head">
        <span>{title}</span>
        <span className="muted">{dur(all)}</span>
      </header>
      <div className="bd-bar">
        {rows.map(([id, ms]) => (
          <i key={id ?? "none"} style={{ flexGrow: ms, "--c": id ? projects.get(id)!.color : "var(--none)" } as CSSProperties} />
        ))}
      </div>
      <div className="bd-rows">
        {shown.map(([id, ms]) => {
          const key = id ?? "__none";
          const p = id ? projects.get(id) : undefined;
          const pct = Math.round((ms / all) * 100);
          return (
            <button
              type="button"
              key={key}
              className="bd-row"
              data-ctx-project={id ?? undefined}
              data-on={active.includes(key) || undefined}
              data-off={(active.length > 0 && !active.includes(key)) || undefined}
              data-none={!id || undefined}
              onClick={() => onToggle(key)}
            >
              <ProjectIcon project={p} size={20} />
              <span className="bd-name truncate">{p?.name ?? "Без проекта"}</span>
              <span className="bd-pct">{pct}%</span>
              <span className="bd-ms">{dur(ms)}</span>
            </button>
          );
        })}
        {hidden.length > 0 && (
          <button type="button" className="bd-more" onClick={() => setOpen((o) => !o)}>
            {open ? "Свернуть" : `Ещё ${hidden.length} · ${dur(hidden.reduce((n, r) => n + r[1], 0))}`}
          </button>
        )}
      </div>
    </section>
  );
}

/** Work, leisure, personal, system: one row each; a click shows only that kind's projects. */
export function Kinds({ totals, projects, active, onPick }: {
  totals: Map<string | null, number>;
  projects: Map<string, Project>;
  active: string[];
  onPick: (ids: string[]) => void;
}) {
  const byKind = kindTotals(totals, projects);
  const all = [...byKind.values()].reduce((a, b) => a + b, 0);
  if (!all) return null;
  const rows = ([...KINDS, null] as (ProjectKind | null)[]).filter((k) => (byKind.get(k) ?? 0) >= 60_000);
  const max = Math.max(...rows.map((k) => byKind.get(k) ?? 0));
  const idsOf = (k: ProjectKind | null) =>
    k === null ? ["__none"] : [...totals.keys()].filter((id): id is string => !!id && projects.has(id) && kindOf(projects.get(id)) === k);
  const isOn = (k: ProjectKind | null) => {
    const ids = idsOf(k);
    return active.length > 0 && active.length === ids.length && ids.every((i) => active.includes(i));
  };
  return (
    <section className="card bd">
      <header className="card-head">
        <span>Чем занимался</span>
        <span className="muted">{dur(all)}</span>
      </header>
      <div className="bd-rows">
        {rows.map((k) => {
          const ms = byKind.get(k) ?? 0;
          const color = k ? KIND_COLOR[k] : "var(--none)";
          const on = isOn(k);
          return (
            <button
              type="button"
              key={k ?? "none"}
              className="bd-row bd-row-kind"
              data-on={on || undefined}
              data-off={(active.length > 0 && !on) || undefined}
              onClick={() => onPick(on ? [] : idsOf(k))}
            >
              <span className="dot" style={{ background: color, width: 9, height: 9 }} />
              <span className="bd-name">{k ? KIND_LABEL[k] : "Без проекта"}</span>
              <span className="bd-meter">
                <i style={{ width: `${(ms / max) * 100}%`, background: color }} />
              </span>
              <span className="bd-pct">{Math.round((ms / all) * 100)}%</span>
              <span className="bd-ms">{dur(ms)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** What the leisure time actually was: per leisure project, the games, channels and videos behind it. */
export function Leisure({ model, projects, limit = 3 }: { model: Model; projects: Map<string, Project>; limit?: number }) {
  const { go } = useNav();
  const groups = new Map<string, { ms: number; items: Map<string, number> }>();
  for (const s of model.segments) {
    const p = s.projectId ? projects.get(s.projectId) : undefined;
    if (!p || kindOf(p) !== "leisure") continue;
    const g = groups.get(p.id) ?? { ms: 0, items: new Map() };
    groups.set(p.id, g);
    const d = s.end - s.start;
    g.ms += d;
    const label = (s.context || appName(s.app)).replace(/ - (YouTube|Twitch)$/, "");
    g.items.set(label, (g.items.get(label) ?? 0) + d);
  }
  const rows = [...groups.entries()].filter(([, g]) => g.ms >= 60_000).sort((a, b) => b[1].ms - a[1].ms);
  if (!rows.length) return null;
  const all = rows.reduce((n, [, g]) => n + g.ms, 0);
  return (
    <section className="card leisure">
      <header className="card-head">
        <span>Досуг</span>
        <span className="muted">{dur(all)}</span>
      </header>
      <div className="leisure-rows">
        {rows.map(([id, g]) => {
          const p = projects.get(id)!;
          const items = [...g.items.entries()].filter(([, ms]) => ms >= 60_000).sort((a, b) => b[1] - a[1]).slice(0, limit);
          return (
            <div key={id} className="leisure-group">
              <button type="button" className="leisure-head" data-ctx-project={id} onClick={() => go({ screen: "project", projectId: id })}>
                <ProjectIcon project={p} size={18} />
                <span className="truncate">{p.name}</span>
                <b>{dur(g.ms)}</b>
              </button>
              {items.map(([label, ms]) => (
                <div key={label} className="leisure-item">
                  <span className="truncate" title={label}>
                    {label}
                  </span>
                  <span>{dur(ms)}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
