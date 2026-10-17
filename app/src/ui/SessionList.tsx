import { Eye, Phone, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { assign } from "../data/assign";
import type { Project, Session } from "../engine/types";
import { clock, dayNum, dur, startOfDay, weekday } from "../lib/time";
import { AppIcon } from "./bits";
import { Popover } from "./Popover";
import { ProjectPicker } from "./ProjectPicker";

type Props = {
  sessions: Session[];
  projects: Map<string, Project>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** show a day header between days (week, project pages) */
  grouped?: boolean;
  titles?: Map<string, string>;
  /** a day's full total for the headers; the shown rows skip short sessions */
  dayTotal?: (day: number) => number;
  empty?: string;
};

const MONTH = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export function SessionList({ sessions, projects, selected, onSelect, grouped, titles, dayTotal, empty = "Пока пусто" }: Props) {
  if (!sessions.length) return <div className="empty">{empty}</div>;

  const groups: { day: number; items: Session[]; ms: number }[] = [];
  for (const s of sessions) {
    const d = startOfDay(s.start);
    const g = groups[groups.length - 1];
    if (g && (!grouped || g.day === d)) {
      g.items.push(s);
      g.ms += s.active;
    } else groups.push({ day: d, items: [s], ms: s.active });
  }

  return (
    <div className="sl">
      {groups.map((g) => (
        <div key={g.day} className="sl-group">
          {grouped && (
            <div className="sl-day">
              <span>
                {weekday(g.day)}, {dayNum(g.day)} {MONTH[new Date(g.day).getMonth()]}
              </span>
              <span>{dur(dayTotal ? dayTotal(g.day) : g.ms)}</span>
            </div>
          )}
          {g.items.map((s) => (
            <SessionRow
              key={s.id}
              s={s}
              project={s.projectId ? projects.get(s.projectId) : undefined}
              title={titles?.get(s.id)}
              selected={selected === s.id}
              onSelect={() => onSelect(selected === s.id ? null : s.id)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function SessionRow({ s, project, title, selected, onSelect }: { s: Session; project?: Project; title?: string; selected: boolean; onSelect: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    else setPicking(false);
  }, [selected]);

  const extra = s.apps.filter((a) => a !== s.app).slice(0, 3);

  return (
    <div
      ref={ref}
      className="sl-row"
      data-ctx-project={s.projectId ?? undefined}
      data-ctx-day={s.start}
      data-selected={selected || undefined}
      data-none={!project || undefined}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) onSelect();
      }}
    >
      <span className="sl-time">
        <b>{clock(s.start)}</b>
        <span>{clock(s.end)}</span>
      </span>
      <span className="sl-bar" style={{ background: project?.color ?? "var(--none)" }} />
      <span className="sl-body">
        <span className="sl-title">
          <span className="truncate">{title || s.label}</span>
          {title && <Sparkles size={11} className="sl-ai" />}
        </span>
        <span className="sl-meta">
          <span className="sl-project" style={project ? { color: project.color } : undefined}>
            {project?.name ?? "Без проекта"}
          </span>
          <AppIcon app={s.app} size={14} />
          {extra.map((a) => (
            <AppIcon key={a} app={a} size={14} />
          ))}
          {title && <span className="truncate sl-ctx">{s.label}</span>}
          {s.call > 60_000 && <Phone size={11} className="sl-flag" />}
          {s.watch > 60_000 && <Eye size={12} className="sl-flag" />}
        </span>
        {selected && (
          <button
            ref={btn}
            type="button"
            className="sl-assign"
            onClick={(e) => {
              e.stopPropagation();
              setPicking(true);
            }}
          >
            {project ? `Проект: ${project.name} — изменить` : "Указать проект"}
          </button>
        )}
      </span>
      <span className="sl-dur">{dur(s.active)}</span>
      <Popover anchor={btn.current} open={picking} onClose={() => setPicking(false)}>
        <div onClick={(e) => e.stopPropagation()}>
          <ProjectPicker
            current={s.projectId}
            onPick={(id) => {
              assign(id, s.app, s.label);
              setPicking(false);
            }}
            footer={<span>Правило: «{s.label}» → проект. История пересчитается.</span>}
          />
        </div>
      </Popover>
    </div>
  );
}
