import { FolderKanban, Inbox, Lock, ScrollText, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { useBackend, useStatus } from "../data/backend";
import { useStore } from "../data/store";
import { useModel } from "../data/useModel";
import { KIND_LABEL, KINDS, kindOf } from "../engine/rules";
import { addDays, dur, startOfDay } from "../lib/time";
import { GRAN_KEY, GRAN_LABEL, GRANS, screenOf } from "../lib/period";
import { useNav, type Screen } from "../nav";
import { GRAN_ICON } from "./PeriodBar";
import { Focus } from "./Focus";
import { Logo } from "./Logo";
import { useLock } from "./Lock";
import { ProjectIcon } from "./ProjectIcon";

function Item({ screen, icon, children, badge, hint }: { screen: Screen; icon: ReactNode; children: ReactNode; badge?: string; hint?: string }) {
  const { nav, go } = useNav();
  const active = nav.screen === screen || (screen === "projects" && nav.screen === "project");
  return (
    <button type="button" className="sb-item" data-active={active || undefined} onClick={() => go({ screen, projectFilter: [], appFilter: [] })} title={hint ? `${children}  ${hint}` : undefined}>
      {icon}
      <span className="truncate">{children}</span>
      {badge && <span className="sb-badge">{badge}</span>}
      {hint && !badge && <kbd className="sb-key">{hint}</kbd>}
    </button>
  );
}

export function Sidebar() {
  const today = startOfDay(Date.now());
  const { model } = useModel(today, addDays(today, 1));
  const { projects } = useStore();
  const { nav, go } = useNav();
  const has = useBackend().data;
  const status = useStatus().data;
  const lock = useLock();

  const spent = (id: string) => model?.byProject.get(id) ?? 0;
  const busy = projects.filter((p) => !p.archived && spent(p.id) >= 60_000).sort((a, b) => spent(b.id) - spent(a.id));
  const unassigned = model?.byProject.get(null) ?? 0;
  // with our own sensors, "recording" means signals arrive; without them, that ActivityWatch data is fresh
  const recording = status ? !status.paused && Date.now() - status.lastSignal < 60_000 : Date.now() - (model?.lastEvent ?? 0) < 5 * 60_000;

  return (
    <aside className="sidebar">
      <div className="brand">
        <Logo />
        <span className="rec" data-on={recording || undefined} title={recording ? "Данные приходят" : status?.paused ? "Запись на паузе" : "Нет свежих данных"}>
          <span className="rec-dot" />
          {recording ? "запись" : "пауза"}
        </span>
      </div>

      <nav className="sb-nav">
        {GRANS.map((g) => (
          <Item key={g} screen={screenOf(g)} icon={GRAN_ICON[g](16)} hint={GRAN_KEY[g].toUpperCase()}>
            {GRAN_LABEL[g]}
          </Item>
        ))}
        <span className="sb-gap" />
        <Item screen="unsorted" icon={<Inbox size={16} strokeWidth={1.75} />} badge={unassigned > 60_000 ? dur(unassigned) : undefined}>
          Неразобранное
        </Item>
        <Item screen="projects" icon={<FolderKanban size={16} strokeWidth={1.75} />}>
          Проекты
        </Item>
      </nav>

      <Focus />

      <div className="sb-section">
        <span className="sb-title">Сегодня по проектам</span>
        {busy.length === 0 && <span className="sb-empty">Пока ничего не разнесено</span>}
        {KINDS.map((k) => {
          const list = busy.filter((p) => kindOf(p) === k);
          if (!list.length) return null;
          return (
            <div key={k} className="sb-kind">
              <span className="sb-kind-head">
                {KIND_LABEL[k]}
                <span>{dur(list.reduce((n, p) => n + spent(p.id), 0))}</span>
              </span>
              {list.map((p) => {
                const on = nav.screen === "project" && nav.projectId === p.id;
                return (
                  <button key={p.id} type="button" className="sb-project" data-ctx-project={p.id} data-active={on || undefined} onClick={() => go({ screen: "project", projectId: p.id })}>
                    <ProjectIcon project={p} size={18} />
                    <span className="truncate">{p.name}</span>
                    <span className="sb-time">{dur(spent(p.id))}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="sidebar-foot">
        <nav className="sb-nav">
          {has && (
            <Item screen="journal" icon={<ScrollText size={16} strokeWidth={1.75} />}>
              Журнал
            </Item>
          )}
          <Item screen="settings" icon={<Settings size={16} strokeWidth={1.75} />}>
            Настройки
          </Item>
          {lock.status.set && (
            <button type="button" className="sb-item" onClick={() => void lock.lock()} title="Заблокировать  Ctrl+L">
              <Lock size={16} strokeWidth={1.75} />
              <span className="truncate">Заблокировать</span>
            </button>
          )}
        </nav>
        {has === false && (
          <div className="source">
            <span className="source-title">Только история ActivityWatch</span>
            <span className="source-sub">бэкенд Tempro не запущен</span>
          </div>
        )}
      </div>
    </aside>
  );
}
