import { AppWindow, FolderKanban, ListFilter, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { appName } from "../engine/context";
import type { Model } from "../engine/types";
import { useStore } from "../data/store";
import { plural } from "../lib/plural";
import { dur } from "../lib/time";
import { useNav } from "../nav";
import { AppIcon, Dot } from "./bits";
import { Menu } from "./Menu";
import { Popover } from "./Popover";
import { ProjectIcon } from "./ProjectIcon";

type Field = "project" | "app";


export function FilterBar({ model, right, compact }: { model: Model | null; right?: ReactNode; compact?: boolean }) {
  const { nav, go } = useNav();
  const { projects } = useStore();
  const btn = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; field: Field | null } | null>(null);

  const apps = useMemo(
    () => (model ? [...model.byApp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40) : []),
    [model],
  );

  const values = (f: Field) => (f === "project" ? nav.projectFilter : nav.appFilter);
  const setValues = (f: Field, v: string[]) => go(f === "project" ? { projectFilter: v } : { appFilter: v });
  const toggle = (f: Field, id: string) => {
    const cur = values(f);
    setValues(f, cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };

  const valueMenu = (f: Field) =>
    f === "project" ? (
      <Menu
        checkboxes
        placeholder="Проект…"
        items={[
          { id: "__none", label: "Без проекта", icon: <Dot />, checked: nav.projectFilter.includes("__none"), hint: model ? dur(model.byProject.get(null) ?? 0) : undefined },
          ...projects
            .filter((p) => !p.archived)
            .map((p) => ({ id: p.id, label: p.name, icon: <ProjectIcon project={p} size={16} />, checked: nav.projectFilter.includes(p.id), hint: model ? dur(model.byProject.get(p.id) ?? 0) : undefined })),
        ]}
        onPick={(id) => toggle("project", id)}
      />
    ) : (
      <Menu
        checkboxes
        placeholder="Программа…"
        items={apps.map(([a, ms]) => ({ id: a, label: appName(a), icon: <AppIcon app={a} size={16} />, checked: nav.appFilter.includes(a), hint: dur(ms) }))}
        onPick={(id) => toggle("app", id)}
      />
    );

  const chip = (f: Field) => {
    const v = values(f);
    if (!v.length) return null;
    const name =
      v.length === 1
        ? f === "project"
          ? v[0] === "__none"
            ? "Без проекта"
            : projects.find((p) => p.id === v[0])?.name ?? "?"
          : appName(v[0])
        : `${v.length} ${f === "project" ? plural(v.length, "проект", "проекта", "проектов") : plural(v.length, "программа", "программы", "программ")}`;
    return (
      <div className="chip" key={f}>
        <span className="chip-seg chip-field">
          {f === "project" ? <FolderKanban size={14} strokeWidth={1.75} /> : <AppWindow size={14} strokeWidth={1.75} />}
          {f === "project" ? "Проект" : "Программа"}
        </span>
        <span className="chip-seg chip-op">{v.length > 1 ? "любой из" : "это"}</span>
        <button type="button" className="chip-seg chip-value" onClick={(e) => setMenu({ anchor: e.currentTarget, field: f })}>
          {name}
        </button>
        <button type="button" className="chip-seg chip-x" aria-label="Убрать фильтр" onClick={() => setValues(f, [])}>
          <X size={14} />
        </button>
      </div>
    );
  };

  return (
    <div className={compact ? "filterbar filterbar-compact" : "filterbar"}>
      <button ref={btn} type="button" className={compact ? "btn btn-quiet" : "btn btn-ghost-white"} onClick={() => setMenu({ anchor: btn.current!, field: null })}>
        <ListFilter size={15} strokeWidth={1.75} />
        Фильтр
      </button>
      {chip("project")}
      {chip("app")}
      {right && <div className="filterbar-right">{right}</div>}

      <Popover anchor={menu?.anchor ?? null} open={!!menu} onClose={() => setMenu(null)}>
        {menu?.field == null ? (
          <Menu
            placeholder="Фильтр…"
            items={[
              { id: "project", label: "Проект", icon: <FolderKanban size={15} strokeWidth={1.75} /> },
              { id: "app", label: "Программа", icon: <AppWindow size={15} strokeWidth={1.75} /> },
            ]}
            onPick={(id) => setMenu((m) => (m ? { ...m, field: id as Field } : m))}
          />
        ) : (
          valueMenu(menu.field)
        )}
      </Popover>
    </div>
  );
}

/** Apply nav filters to anything that has a project and an app. */
export function useFilter() {
  const { nav } = useNav();
  const pf = nav.projectFilter;
  const af = nav.appFilter;
  return useCallback(
    (projectId: string | null, app: string) =>
      (!pf.length || pf.includes(projectId ?? "__none")) && (!af.length || af.includes(app)),
    [pf, af],
  );
}
