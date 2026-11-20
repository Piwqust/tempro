import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { focusManager, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export const TICK = "tempro:tick";

/** The backend sends "tick" every 10 minutes. A hidden window's own timers are throttled and its
 *  queries stop refetching, so this is what keeps the background jobs going for weeks in the tray:
 *  fresh events (AutoSort reacts to them) and a nudge for Retention. Renders nothing. */
export function Heartbeat() {
  const qc = useQueryClient();
  useEffect(() => {
    if (!isTauri()) return;
    const off = listen("tick", () => {
      void qc.invalidateQueries({ queryKey: ["events"] });
      window.dispatchEvent(new Event(TICK));
    });
    return () => {
      off.then((f) => f());
    };
  }, [qc]);
  // a window hidden in the tray still looks visible to the page, so queries kept polling every
  // few seconds; told by the backend instead, they poll only while the window is on screen
  useEffect(() => {
    if (!isTauri()) return;
    const set = (shown: boolean) => focusManager.setFocused(shown);
    getCurrentWindow().isVisible().then(set, () => {});
    const offs = [listen("window-shown", () => set(true)), listen("window-hidden", () => set(false))];
    return () => offs.forEach((off) => off.then((f) => f()));
  }, []);
  return null;
}
