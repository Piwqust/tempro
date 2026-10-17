import { useEffect, useRef } from "react";
import { autoSort } from "../data/ai";
import { useSettings } from "../data/backend";
import { useStore } from "../data/store";
import { useModel } from "../data/useModel";
import { addDays, startOfDay } from "../lib/time";

const EVERY_MS = 30 * 60_000;

/** Background: every half hour the model looks at today's new unassigned titles. Renders nothing. */
export function AutoSort() {
  const { settings, available } = useSettings();
  const today = startOfDay(Date.now());
  const { model } = useModel(today, addDays(today, 1));
  const { projects, rules } = useStore();
  const last = useRef(0);
  const on = available && settings.aiProvider !== "none" && settings.aiAuto;

  useEffect(() => {
    if (!on || !model || Date.now() - last.current < EVERY_MS) return;
    last.current = Date.now();
    autoSort(model, projects, rules).catch((e) => console.warn("autoSort", e));
  }, [on, model, projects, rules]);

  return null;
}
