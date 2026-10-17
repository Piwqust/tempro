import { ArrowLeft, Download, FolderKanban } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { useModel, useProjects } from "../data/useModel";
import { actions } from "../data/store";
import { appName } from "../engine/context";
import { KIND_COLOR, KIND_LABEL, kindOf } from "../engine/rules";
import { saveCsv, sessionsCsv } from "../lib/csv";
import { addDays, dayNum, dur, HOUR, startOfDay, weekday } from "../lib/time";
import { useNav } from "../nav";
import { AppIcon, BigNum } from "../ui/bits";
import { SessionList } from "../ui/SessionList";
import { ProjectSettings } from "../ui/ProjectSettings";
import { TopBar } from "../ui/TopBar";
import { ProjectIcon } from "../ui/ProjectIcon";
import { Loading, LoadError } from "./states";

const RANGES = [7, 30, 90] as const;

export function Project() {
  const { nav, go } = useNav();
  const projects = useProjects();
  const p = nav.projectId ? projects.get(nav.projectId) : undefined;
  const [days, setDays] = useState<number>(30);
  const today = startOfDay(Date.now());
  const from = addDays(today, 1 - days);
  const to = addDays(today, 1);
  const { model, error, loading } = useModel(from, to);
  const [selected, setSelected] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const data = useMemo(() => {
    if (!model || !p) return null;
    const own = model.segments.filter((s) => s.projectId === p.id);
    const perDay = Array.from({ length: days }, (_, i) => ({ day: addDays(from, i), ms: 0 }));
    const docs = new Map<string, { ms: number; app: string }>();
    const apps = new Map<string, number>();
    for (const s of own) {
      const d = s.end - s.start;
      const i = Math.round((startOfDay(s.start) - from) / (24 * HOUR));
      if (perDay[i]) perDay[i].ms += d;
      const label = s.context || appName(s.app);
      const cur = docs.get(label) ?? { ms: 0, app: s.app };
      cur.ms += d;
      docs.set(label, cur);
      apps.set(s.app, (apps.get(s.app) ?? 0) + d);
    }
    const total = own.reduce((n, s) => n + (s.end - s.start), 0);
    const week = own.filter((s) => s.start >= addDays(today, -6)).reduce((n, s) => n + (s.end - s.start), 0);
    return {
      total,
      week,
      perDay,
      docs: [...docs.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 12),
      apps: [...apps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      sessions: model.sessions.filter((s) => s.projectId === p.id),
      agents: model.agents.filter((a) => a.projectId === p.id).reduce((n, a) => n + (a.end - a.start), 0),
      activeDays: perDay.filter((d) => d.ms > 0).length,
    };
  }, [model, p, days, from, today]);

  if (!p) {
    return (
      <>
        <TopBar icon={<FolderKanban size={14} strokeWidth={1.9} />} section="Проекты" />
        <div className="empty">Проект не найден</div>
      </>
    );
  }

  const max = Math.max(HOUR, ...(data?.perDay.map((d) => d.ms) ?? [0]));
  const money = p.rate && data ? (data.total / HOUR) * p.rate : 0;
  const work = kindOf(p) === "work";

  return (
    <>
      <TopBar
        icon={<FolderKanban size={14} strokeWidth={1.9} />}
        section="Проекты"
        title={
          <span className="pj-title">
            <ProjectIcon project={p} size={22} />
            {p.name}
          </span>
        }
        right={
          <>
            <button type="button" className="btn btn-ghost-white" onClick={() => go({ screen: "projects" })}>
              <ArrowLeft size={15} /> Все проекты
            </button>
            <div className="segmented">
              {RANGES.map((r) => (
                <button key={r} type="button" data-on={days === r || undefined} onClick={() => setDays(r)}>
                  {r} дней
                </button>
              ))}
            </div>
          </>
        }
      />
      <div className="screen">
        {error ? (
          <LoadError error={error} />
        ) : loading || !data ? (
          <Loading />
        ) : (
          <>
            <section className="kpis" style={{ "--c": p.color } as CSSProperties}>
              <div className="kpi kpi-main">
                <span className="kpi-label">#{p.name}</span>
                <BigNum ms={data.total} className="kpi-num" />
                <span className="kpi-sub">за {days} дней</span>
              </div>
              <div className="kpi card">
                <span className="kpi-label">7 дней</span>
                <BigNum ms={data.week} className="kpi-num" />
              </div>
              <div className="kpi card">
                <span className="kpi-label">{work ? "в среднем за рабочий день" : "в среднем за день с ним"}</span>
                <BigNum ms={data.activeDays ? data.total / data.activeDays : 0} className="kpi-num" />
                <span className="kpi-sub">{data.activeDays} дн. {work ? "с работой" : "из " + days}</span>
              </div>
              {work ? (
                <div className="kpi card">
                  <span className="kpi-label">ставка в час</span>
                  <label className="rate">
                    <input
                      type="number"
                      min={0}
                      defaultValue={p.rate ?? ""}
                      placeholder="0"
                      onBlur={(e) => actions.updateProject(p.id, { rate: Number(e.target.value) || undefined })}
                    />
                    <span>₽</span>
                  </label>
                  <span className="kpi-sub">{money ? `≈ ${Math.round(money).toLocaleString("ru-RU")} ₽ за период` : "для выгрузки и суммы"}</span>
                </div>
              ) : (
                <div className="kpi card">
                  <span className="kpi-label">вид</span>
                  <span className="kpi-kind" style={{ color: KIND_COLOR[kindOf(p)] }}>
                    {KIND_LABEL[kindOf(p)]}
                  </span>
                  <span className="kpi-sub">не работа: без ставки и не в «Работе»</span>
                </div>
              )}
            </section>

            <section className="card bars">
              <header className="card-head">
                <span>По дням</span>
                {data.agents > 0 && <span className="muted">агенты Claude Code работали {dur(data.agents)}</span>}
              </header>
              <div className="bars-row" style={{ "--c": p.color } as CSSProperties}>
                {data.perDay.map((d) => (
                  <button
                    key={d.day}
                    type="button"
                    className="bar"
                    title={`${weekday(d.day)} ${dayNum(d.day)}: ${dur(d.ms)}`}
                    onClick={() => go({ screen: "today", day: d.day, projectFilter: [p.id] })}
                  >
                    <span className="bar-fill" style={{ height: `${(d.ms / max) * 100}%` }} />
                    {days <= 31 && <span className="bar-label" data-weekend={[0, 6].includes(new Date(d.day).getDay()) || undefined}>{dayNum(d.day)}</span>}
                  </button>
                ))}
              </div>
            </section>

            <ProjectSettings p={p} />

            <div className="two">
              <section className="card list-card">
                <header className="card-head">Документы, вкладки, папки</header>
                {data.docs.length === 0 && <div className="empty">Нет данных</div>}
                {data.docs.map(([label, v]) => (
                  <div key={label} className="list-row">
                    <AppIcon app={v.app} size={16} />
                    <span className="truncate">{label}</span>
                    <span className="list-bar" style={{ "--w": `${(v.ms / data.docs[0][1].ms) * 100}%`, "--c": p.color } as CSSProperties} />
                    <span className="list-num">{dur(v.ms)}</span>
                  </div>
                ))}
              </section>
              <section className="card list-card">
                <header className="card-head">Программы</header>
                {data.apps.map(([app, ms]) => (
                  <div key={app} className="list-row">
                    <AppIcon app={app} size={16} />
                    <span className="truncate">{appName(app)}</span>
                    <span className="list-bar" style={{ "--w": `${(ms / data.apps[0][1]) * 100}%`, "--c": p.color } as CSSProperties} />
                    <span className="list-num">{dur(ms)}</span>
                  </div>
                ))}
              </section>
            </div>

            <section className="card list-card">
              <header className="card-head">
                <span>Сессии</span>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={async () => setSaved(await saveCsv(`${p.name}-${days}d.csv`, sessionsCsv(data.sessions, projects)))}
                >
                  <Download size={14} /> CSV
                </button>
                {saved && <span className="muted">сохранено: {saved}</span>}
              </header>
              <div className="project-sessions">
                <SessionList sessions={data.sessions} projects={projects} selected={selected} onSelect={setSelected} grouped empty="Сессий нет" />
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}
