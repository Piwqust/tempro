import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Square, Target } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useBackend, useManual } from "../data/backend";
import { useModel, useProjects } from "../data/useModel";
import { t } from "../lib/i18n";
import { addDays, HOUR, startOfDay } from "../lib/time";
import { Popover } from "./Popover";
import { ProjectPicker } from "./ProjectPicker";

const pad = (n: number) => String(n).padStart(2, "0");
const elapsed = (ms: number) => `${Math.floor(ms / HOUR)}:${pad(Math.floor((ms % HOUR) / 60_000))}`;

/** "I'm working on X now": a manual span that overrides the rules until stopped (8 h at most). */
export function Focus() {
  const has = useBackend().data;
  const today = startOfDay(Date.now());
  const { model } = useModel(today, addDays(today, 1));
  const projects = useProjects();
  const manual = useManual();
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // opened by the global hotkey: no entry animation for a keyboard action
  const [byKey, setByKey] = useState(false);
  const [, tick] = useState(0);

  const now = Date.now();
  const cur = model?.manual.find((m) => m.kind === "focus" && m.start <= now && m.end > now);
  const p = cur?.projectId ? projects.get(cur.projectId) : undefined;

  useEffect(() => {
    if (!cur) return;
    const t = setInterval(() => tick((n) => n + 1), 20_000);
    return () => clearInterval(t);
  }, [cur]);

  // tray menu and the global hotkey open the picker
  useEffect(() => {
    // the right-click menu asks through the page
    const open = () => (setByKey(false), setOpen(true));
    const openByKey = () => (setByKey(true), setOpen(true));
    window.addEventListener("tempro:focus-picker", open);
    const off = isTauri() ? listen("focus-picker", openByKey) : null;
    return () => {
      window.removeEventListener("tempro:focus-picker", open);
      off?.then((f) => f());
    };
  }, []);

  if (!has) return null;

  return (
    <div className="focus">
      {cur ? (
        <div className="focus-on" style={{ "--c": p?.color ?? "var(--ink-3)" } as CSSProperties}>
          <span className="focus-dot" />
          <span className="truncate">{p?.name ?? t("Фокус")}</span>
          <span className="focus-time">{elapsed(now - cur.start)}</span>
          <button type="button" className="icon-btn" title={t("Остановить")} onClick={() => manual.end(cur.id, Date.now())}>
            <Square size={13} fill="currentColor" />
          </button>
        </div>
      ) : (
        <button ref={btn} type="button" className="focus-start" onClick={() => (setByKey(false), setOpen(true))}>
          <Target size={15} strokeWidth={1.75} />
          {t("Сейчас работаю над…")}
        </button>
      )}
      <Popover anchor={btn.current} open={open && !cur} onClose={() => setOpen(false)} instant={byKey}>
        <ProjectPicker
          current={null}
          onPick={(id) => {
            setOpen(false);
            manual.add({ start: Date.now(), end: Date.now() + 8 * HOUR, kind: "focus", projectId: id });
          }}
          footer={<span>{t("Всё время до остановки уйдёт в проект, правила не нужны.")}</span>}
        />
      </Popover>
    </div>
  );
}
