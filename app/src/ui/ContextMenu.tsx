import { useQueryClient } from "@tanstack/react-query";
import { Copy, FolderOpen, Lock, Play, RefreshCw, Settings, CalendarDays } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "../data/store";
import { GRAN_KEY, GRAN_LABEL, GRANS, screenOf } from "../lib/period";
import { t } from "../lib/i18n";
import { dayTitle, startOfDay } from "../lib/time";
import { useNav } from "../nav";
import { useLock } from "./Lock";
import { GRAN_ICON } from "./PeriodBar";
import { ProjectIcon } from "./ProjectIcon";

type Item = { key: string; icon: ReactNode; label: ReactNode; hint?: string; run: () => void } | "sep";

/** Right click shows Tempro's own menu instead of the browser's (Back, Reload, Print, Inspect…):
 *  what is under the cursor first (a project, a day, selected text), then the periods and actions.
 *  Text fields keep the system menu for cut, copy and paste. Elements opt in with
 *  data-ctx-project="id" and data-ctx-day="timestamp". */
export function ContextMenu() {
  const { go } = useNav();
  const { projects } = useStore();
  const lock = useLock();
  const qc = useQueryClient();
  const [at, setAt] = useState<{ x: number; y: number; items: Item[] } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onMenu = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      const items: Item[] = [];
      const text = window.getSelection()?.toString().trim();
      if (text) items.push({ key: "copy", icon: <Copy size={14} />, label: t("Копировать"), hint: "Ctrl+C", run: () => void navigator.clipboard?.writeText(text) });
      const pid = el.closest<HTMLElement>("[data-ctx-project]")?.dataset.ctxProject;
      const p = pid ? projects.find((x) => x.id === pid) : undefined;
      if (p) items.push({ key: "project", icon: <ProjectIcon project={p} size={16} />, label: t("Открыть «{name}»", { name: p.name }), run: () => go({ screen: "project", projectId: p.id }) });
      const day = Number(el.closest<HTMLElement>("[data-ctx-day]")?.dataset.ctxDay);
      if (day && day <= Date.now()) items.push({ key: "day", icon: <CalendarDays size={14} />, label: t("Открыть {day}", { day: dayTitle(day).replace(/^./, (c) => c.toLowerCase()) }), run: () => go({ screen: "today", day: startOfDay(day) }) });
      if (items.length) items.push("sep");
      for (const g of GRANS) items.push({ key: g, icon: GRAN_ICON[g](14), label: GRAN_LABEL[g], hint: GRAN_KEY[g].toUpperCase(), run: () => go({ screen: screenOf(g), projectFilter: [], appFilter: [] }) });
      items.push({ key: "today", icon: <CalendarDays size={14} />, label: t("К сегодня"), hint: "T", run: () => go({ day: startOfDay(Date.now()) }) });
      items.push("sep");
      items.push({ key: "focus", icon: <Play size={14} />, label: t("Сейчас работаю над…"), run: () => window.dispatchEvent(new Event("tempro:focus-picker")) });
      items.push({ key: "projects", icon: <FolderOpen size={14} />, label: t("Проекты"), run: () => go({ screen: "projects" }) });
      items.push({ key: "refresh", icon: <RefreshCw size={14} />, label: t("Обновить данные"), run: () => void qc.invalidateQueries() });
      if (lock.status.set) items.push({ key: "lock", icon: <Lock size={14} />, label: t("Заблокировать"), hint: "Ctrl+L", run: () => void lock.lock() });
      items.push({ key: "settings", icon: <Settings size={14} />, label: t("Настройки"), run: () => go({ screen: "settings" }) });
      setPos(null);
      setAt({ x: e.clientX, y: e.clientY, items });
    };
    window.addEventListener("contextmenu", onMenu);
    return () => window.removeEventListener("contextmenu", onMenu);
  }, [go, projects, lock, qc]);

  // keep it inside the window
  useLayoutEffect(() => {
    if (!at || !ref.current) return;
    const r = { width: ref.current.offsetWidth, height: ref.current.offsetHeight };
    setPos({ x: Math.max(6, Math.min(at.x, window.innerWidth - r.width - 6)), y: Math.max(6, Math.min(at.y, window.innerHeight - r.height - 6)) });
  }, [at]);

  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    window.addEventListener("wheel", close, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
      window.removeEventListener("wheel", close);
    };
  }, [at]);

  if (!at) return null;
  return (
    <div ref={ref} className="ctx" role="menu" // grows out of the cursor, even when it was pushed back inside the window
      style={{ left: pos?.x ?? at.x, top: pos?.y ?? at.y, opacity: pos ? 1 : 0, transformOrigin: pos ? `${at.x - pos.x}px ${at.y - pos.y}px` : undefined }}>
      {at.items.map((it, i) =>
        it === "sep" ? (
          <span key={`s${i}`} className="ctx-sep" />
        ) : (
          <button
            key={it.key}
            type="button"
            role="menuitem"
            className="ctx-item"
            onClick={() => {
              setAt(null);
              it.run();
            }}
          >
            <span className="ctx-icon">{it.icon}</span>
            <span className="ctx-label truncate">{it.label}</span>
            {it.hint && <kbd className="ctx-hint">{it.hint}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
