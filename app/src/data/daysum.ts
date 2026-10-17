import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { compute } from "../engine/compute";
import { compileRules } from "../engine/rules";
import { emptyDay, summarize, type DaySum } from "../engine/summary";
import type { Project } from "../engine/types";
import { daysIn, monthsIn } from "../lib/period";
import { addMonths, startOfDay } from "../lib/time";
import { fetchRaw } from "./api";
import { useStore } from "./store";

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** Day summaries for any stretch, loaded a month at a time. The raw events of a month are
 *  computed, reduced and dropped; finished months are kept until the rules or projects change. */
export function useDaySums(from: number, to: number, enabled = true) {
  const { projects, rules } = useStore();
  const version = useMemo(() => fnv(JSON.stringify([rules, projects])), [rules, projects]);
  const match = useMemo(() => compileRules(rules, projects), [rules, projects]);
  const byId = useMemo(() => new Map<string, Project>(projects.map((p) => [p.id, p])), [projects]);
  const months = monthsIn(from, to);

  const qs = useQueries({
    queries: months.map((m) => {
      const end = addMonths(m, 1);
      const live = Date.now() < end;
      return {
        queryKey: ["daysum", m, version],
        queryFn: async () => {
          const model = compute(await fetchRaw(m, end), m, end, match);
          return summarize(model, byId, startOfDay);
        },
        enabled: enabled && m <= Date.now(),
        staleTime: live ? 60_000 : Infinity,
        refetchInterval: live ? 5 * 60_000 : (false as const),
        gcTime: 30 * 60_000,
        // keep showing the old numbers while a rule change recomputes them
        placeholderData: (prev: Map<number, DaySum> | undefined) => prev,
      };
    }),
  });

  const days = useMemo(() => {
    const all = new Map<number, DaySum>();
    for (const q of qs) for (const [d, s] of q.data ?? []) all.set(d, s);
    return daysIn(from, to).map((d) => all.get(d) ?? emptyDay(d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, ...qs.map((q) => q.data)]);

  const pending = qs.filter((q) => q.isLoading).length;
  return { days, loading: pending > 0 && qs.every((q) => !q.data), progress: months.length ? 1 - pending / months.length : 1, error: (qs.find((q) => q.error)?.error as Error | undefined) ?? null };
}
