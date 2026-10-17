import { useQueryClient } from "@tanstack/react-query";
import { Copy, FolderOpen, Lock, Play, RefreshCw, Settings, CalendarDays } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  // closing fades out in 100ms, quicker than the entry; input stops at once
  const [leaving, setLeaving] = useState(false);
  const timer = useRef(0);
  const close = useCallback(() => {
    if (timer.current) return;
    setLeaving(true);
    timer.current = window.setTimeout(() => {
      timer.current = 0;
      setLeaving(false);
      setAt(null);
    }, 100);
  }, []);

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
      clearTimeout(timer.current);
      timer.current = 0;
      setLeaving(false);
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
    // focus the first item so the arrows work right away; after a mouse click it shows no ring
    ref.current.querySelector<HTMLElement>(".ctx-item")?.focus();
  }, [at]);

  useEffect(() => {
    if (!at || leaving) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close();
    // capture phase: the arrows must move through the menu, not step the day behind it.
    // Any other key closes the menu and goes on, so the D W M Q Y T hints in it just work
    const onKey = (e: KeyboardEvent) => {
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
      const items = [...(ref.current?.querySelectorAll<HTMLElement>(".ctx-item") ?? [])];
      const i = items.indexOf(document.activeElement as HTMLElement);
      const to = e.key === "ArrowDown" ? (i + 1) % items.length : e.key === "ArrowUp" ? (i - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
      if (to >= 0) {
        e.preventDefault();
        e.stopPropagation();
        items[to]?.focus();
      } else if (e.key === "Escape") {
        // only the menu closes, the selected session behind it stays selected
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key !== "Enter" && e.key !== " " && e.key !== "Tab") close();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", close);
    window.addEventListener("wheel", close, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("wheel", close);
    };
  }, [at, leaving, close]);

  if (!at) return null;
  // grows out of the cursor, even when it was pushed back inside the window
  const origin = pos ? `${at.x - pos.x}px ${at.y - pos.y}px` : undefined;
  return (
    <div
      ref={ref}
      className="ctx"
      role="menu"
      style={{ left: pos?.x ?? at.x, top: pos?.y ?? at.y, opacity: pos && !leaving ? 1 : 0, transformOrigin: origin, pointerEvents: leaving ? "none" : undefined }}
    >
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
              close();
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
