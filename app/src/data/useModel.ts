import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { compute } from "../engine/compute";
import { compileRules } from "../engine/rules";
import type { Model, Project } from "../engine/types";
import { fetchRaw } from "./api";
import { useSettings } from "./backend";
import { useStore } from "./store";

/** refetchMs: how often a range that includes now is reloaded; a month is heavy, it waits longer */
export function useModel(from: number, to: number, refetchMs = 30_000) {
  const live = Date.now() < to;
  const q = useQuery({
    queryKey: ["events", from, to],
    queryFn: () => fetchRaw(from, to),
    refetchInterval: live ? refetchMs : false,
    staleTime: live ? 15_000 : 5 * 60_000,
  });
  const { projects, rules } = useStore();
  const { settings } = useSettings();
  const match = useMemo(() => compileRules(rules, projects), [rules, projects]);
  // recomputed from raw events whenever rules change: history follows the rules
  const model = useMemo<Model | null>(
    () => (q.data ? compute(q.data, from, to, match, { questionMinutes: settings.questionMinutes }) : null),
    [q.data, from, to, match, settings.questionMinutes],
  );
  return { model, error: q.error as Error | null, loading: q.isLoading };
}

export function useProjects(): Map<string, Project> {
  const { projects } = useStore();
  return useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
}
