import { ChevronRight, FolderKanban, Plus } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { actions, useStore } from "../data/store";
import { KIND_COLOR, KIND_LABEL, KINDS, kindOf } from "../engine/rules";
import type { Project } from "../engine/types";
import { useModel } from "../data/useModel";
import { addDays, dur, HOUR, startOfDay } from "../lib/time";
import { useNav } from "../nav";
import { TopBar } from "../ui/TopBar";
import { ProjectIcon } from "../ui/ProjectIcon";

const DAYS = 30;

export function Projects() {
  const { projects, rules } = useStore();
  const { go } = useNav();
  const today = startOfDay(Date.now());
  const from = addDays(today, 1 - DAYS);
  const { model } = useModel(from, addDays(today, 1));
  const [showArchived, setShowArchived] = useState(false);
  const [name, setName] = useState("");

  // per project: hours per day for the sparkline, last 7 days, total
  const stats = useMemo(() => {
    const m = new Map<string, { days: number[]; week: number; total: number }>();
    if (!model) return m;
    const weekFrom = addDays(today, -6);
    for (const s of model.segments) {
      if (!s.projectId) continue;
      let st = m.get(s.projectId);
      if (!st) m.set(s.projectId, (st = { days: new Array(DAYS).fill(0), week: 0, total: 0 }));
      const d = s.end - s.start;
      const i = Math.round((startOfDay(s.start) - from) / (24 * HOUR));
      if (i >= 0 && i < DAYS) st.days[i] += d;
      if (s.start >= weekFrom) st.week += d;
      st.total += d;
    }
    return m;
  }, [model, from, today]);

  const list = projects
    .filter((p) => !!p.archived === showArchived)
    .sort((a, b) => (stats.get(b.id)?.total ?? 0) - (stats.get(a.id)?.total ?? 0));
  const max = Math.max(HOUR, ...[...stats.values()].flatMap((s) => s.days));

  const row = (p: Project) => {
    const st = stats.get(p.id);
    const n = rules.filter((r) => r.projectId === p.id).length;
    return (
      <button key={p.id} type="button" className="ptable-row" data-ctx-project={p.id} onClick={() => go({ screen: "project", projectId: p.id })}>
        <span className="ptable-name">
          <ProjectIcon project={p} size={22} />
          <span className="truncate">{p.name}</span>
          {p.rate ? <span className="ptable-rate">{p.rate} ₽/ч</span> : null}
        </span>
        <span className="spark" style={{ "--c": p.color } as CSSProperties}>
          {(st?.days ?? new Array(DAYS).fill(0)).map((ms, i) => (
            <i key={i} style={{ height: ms ? `${Math.max(8, (ms / max) * 100)}%` : undefined }} data-empty={!ms || undefined} />
          ))}
        </span>
        <span className="num">{model ? (st?.week ? dur(st.week) : "—") : "…"}</span>
        <span className="num strong">{model ? (st?.total ? dur(st.total) : "—") : "…"}</span>
        <span className="num muted">{n}</span>
        <ChevronRight size={16} className="ptable-go" />
      </button>
    );
  };

  return (
    <>
      <TopBar
        icon={<FolderKanban size={14} strokeWidth={1.9} />}
        section="Проекты"
        right={
          <div className="segmented">
            <button type="button" data-on={!showArchived || undefined} onClick={() => setShowArchived(false)}>
              Активные
            </button>
            <button type="button" data-on={showArchived || undefined} onClick={() => setShowArchived(true)}>
              Архив
            </button>
          </div>
        }
      />
      <div className="screen">
        <section className="card ptable">
          <div className="ptable-head">
            <span>Проект</span>
            <span>30 дней по дням</span>
            <span className="num">7 дней</span>
            <span className="num">30 дней</span>
            <span className="num">Правил</span>
            <span />
          </div>
          {KINDS.flatMap((k) => {
            const group = list.filter((p) => kindOf(p) === k);
            if (!group.length) return [];
            const sum = group.reduce((n, p) => n + (stats.get(p.id)?.total ?? 0), 0);
            return [
              <div key={k} className="ptable-kind">
                <span className="dot" style={{ background: KIND_COLOR[k], width: 8, height: 8 }} />
                {KIND_LABEL[k]}
                <span className="muted">{group.length}</span>
                <span className="ptable-kind-sum">{model && sum ? dur(sum) : ""}</span>
              </div>,
              ...group.map((p) => row(p)),
            ];
          })}
          {list.length === 0 && <div className="empty">{showArchived ? "Архив пуст" : "Проектов нет"}</div>}
          {!showArchived && (
            <form
              className="ptable-new"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) {
                  const p = actions.addProject(name);
                  setName("");
                  go({ screen: "project", projectId: p.id });
                }
              }}
            >
              <Plus size={16} strokeWidth={1.7} />
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Новый проект — название и Enter" />
            </form>
          )}
        </section>
        <p className="hint page-hint">
          Время попадает в проект по правилам: слово в заголовке, адресе вкладки, папке или тексте с экрана. Правила и цвет — на странице проекта.
        </p>
      </div>
    </>
  );
}
