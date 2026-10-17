import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { SEEN_KEY } from "../data/ai";
import { call, fetchRaw } from "../data/api";
import { useSettings } from "../data/backend";
import { refreshStore, storeReady, storeSnapshot } from "../data/store";
import { pinsFor } from "../engine/compute";
import { compileRules } from "../engine/rules";
import { TICK } from "./Heartbeat";
import { addDays, startOfDay } from "../lib/time";

const EVERY_MS = 6 * 3_600_000;
const STEP_DAYS = 7;

/** Background: detail older than the retention period is compacted away. Before a row loses its
 *  title, the current rules decide its project, and that project is kept with it. Renders nothing. */
export function Retention() {
  const { settings, available } = useSettings();
  const qc = useQueryClient();
  const busy = useRef(false);
  const days = settings.detailDays;

  useEffect(() => {
    if (!available || !days) return;
    const run = async () => {
      // pins are permanent: never decide them with the starter rules before the real ones loaded
      if (busy.current || !storeReady()) return;
      busy.current = true;
      try {
        await refreshStore();
        const { projects, rules } = storeSnapshot();
        const match = compileRules(rules, projects);
        const before = addDays(startOfDay(Date.now()), -days);
        // the AI's "already looked at" list is keyed by title: it forgets on the same schedule
        const seen = await call<Record<string, number> | null>("kv_get", { key: SEEN_KEY });
        if (seen && Object.values(seen).some((t) => t < before)) {
          await call("kv_put", { key: SEEN_KEY, value: Object.fromEntries(Object.entries(seen).filter(([, t]) => t >= before)) });
        }
        const oldest = await call<number | null>("compact_todo", { before });
        if (oldest == null) return;
        for (let from = startOfDay(oldest); from < before; from = addDays(from, STEP_DAYS)) {
          const to = Math.min(before, addDays(from, STEP_DAYS));
          const raw = await fetchRaw(from, to);
          await call("compact", { before, until: to, pins: pinsFor(raw, from, to, match) });
        }
        await qc.invalidateQueries({ queryKey: ["events"] });
      } catch (e) {
        console.warn("retention", e);
      } finally {
        busy.current = false;
      }
    };
    // the backend's tick wakes a hidden window; the job itself only runs every few hours
    let last = 0;
    const due = () => {
      if (Date.now() - last < EVERY_MS) return;
      last = Date.now();
      void run();
    };
    const first = setTimeout(due, 20_000);
    window.addEventListener(TICK, due);
    return () => (clearTimeout(first), window.removeEventListener(TICK, due));
  }, [available, days, qc]);

  return null;
}
