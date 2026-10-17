import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, startOfDay } from "./lib/time";
import { DEMO } from "./data/api";
import { useSettings } from "./data/backend";
import { getLang, langSetting, setLang } from "./lib/i18n";
import { NavContext, type Nav } from "./nav";
import { Journal } from "./screens/Journal";
import { granOf, GRAN_KEY, GRANS, screenOf, step } from "./lib/period";
import { Month } from "./screens/Month";
import { Range } from "./screens/Range";
import { Project } from "./screens/Project";
import { Projects } from "./screens/Projects";
import { Settings } from "./screens/Settings";
import { Today } from "./screens/Today";
import { Unsorted } from "./screens/Unsorted";
import { Week } from "./screens/Week";
import { AutoSort } from "./ui/AutoSort";
import { Heartbeat } from "./ui/Heartbeat";
import { Retention } from "./ui/Retention";
import { Sidebar } from "./ui/Sidebar";
import { LockScreen, useLock } from "./ui/Lock";
import { ContextMenu } from "./ui/ContextMenu";

/** Demo links open a given screen and day: ?demo&screen=year&day=-1 (days from today) or &project=p_tempro */
function demoNav(): Partial<Nav> {
  if (!DEMO) return {};
  const q = new URLSearchParams(location.search);
  const out: Partial<Nav> = {};
  const screen = q.get("screen") as Nav["screen"] | null;
  if (screen) out.screen = screen;
  const day = Number(q.get("day"));
  if (q.has("day") && Number.isFinite(day)) out.day = addDays(startOfDay(Date.now()), day);
  if (q.get("project")) out.projectId = q.get("project")!;
  return out;
}

export default function App() {
  const [nav, setNav] = useState<Nav>(() => ({ screen: "today", day: startOfDay(Date.now()), projectFilter: [], appFilter: [], ...demoNav() }));
  const go = useCallback((patch: Partial<Nav>) => setNav((n) => ({ ...n, ...patch })), []);
  const ctx = useMemo(() => ({ nav, go }), [nav, go]);
  const lock = useLock();
  const { settings, loaded } = useSettings();
  // the backend keeps the choice too (tray menu, AI answers); it wins when the two disagree
  useEffect(() => {
    document.documentElement.lang = getLang();
    if (loaded && !DEMO && settings.lang !== langSetting()) setLang(settings.lang);
  }, [loaded, settings.lang]);
  const lockRef = useRef(lock);
  lockRef.current = lock;

  // the window can sit hidden in the tray for weeks: "today" opened back up must be today
  useEffect(() => {
    let opened = startOfDay(Date.now());
    const check = () => {
      const now = startOfDay(Date.now());
      if (now === opened) return;
      setNav((n) => (n.day === opened ? { ...n, day: now } : n));
      opened = now;
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => (window.removeEventListener("focus", check), document.removeEventListener("visibilitychange", check));
  }, []);

  // one set of keys for every period screen: ← → (or [ ]) step, T is today, D W M Q Y switch the stretch
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+L: lock right now, as on Windows itself
      if (e.ctrlKey && !e.altKey && e.code === "KeyL" && lockRef.current.status.set) {
        e.preventDefault();
        void lockRef.current.lock();
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable], .popover")) return;
      const key = e.key.toLowerCase();
      // by physical key: the same keys work on a Russian layout
      const phys = e.code.toLowerCase();
      const code = phys.startsWith("key") ? phys.slice(3) : "";
      setNav((n) => {
        const g = granOf(n.screen);
        if (g && (key === "arrowleft" || phys === "bracketleft")) return { ...n, day: step(g, n.day, -1) };
        if (g && (key === "arrowright" || phys === "bracketright")) return { ...n, day: step(g, n.day, 1) };
        if (g && code === "t") return { ...n, day: startOfDay(Date.now()) };
        const to = code ? GRANS.find((x) => GRAN_KEY[x] === code) : undefined;
        if (to) return { ...n, screen: screenOf(to), projectFilter: [], appFilter: [] };
        return n;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <NavContext.Provider value={ctx}>
      <div className="app">
        {/* background jobs keep running behind the lock */}
        <Heartbeat />
        <AutoSort />
        <Retention />
        {!lock.loaded ? null : lock.appLocked ? (
          <LockScreen />
        ) : (
          <>
        <ContextMenu />
        <Sidebar />
        <main className="main" key={nav.screen + (nav.projectId ?? "")}>
          {nav.screen === "today" && <Today />}
          {nav.screen === "week" && <Week />}
          {nav.screen === "month" && <Month />}
          {nav.screen === "quarter" && <Range gran="quarter" />}
          {nav.screen === "year" && <Range gran="year" />}
          {nav.screen === "unsorted" && <Unsorted />}
          {nav.screen === "projects" && <Projects />}
          {nav.screen === "project" && <Project />}
          {nav.screen === "journal" && <Journal />}
          {nav.screen === "settings" && <Settings />}
        </main>
          </>
        )}
      </div>
    </NavContext.Provider>
  );
}
