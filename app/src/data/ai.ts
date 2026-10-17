// Claude (Haiku 5.5 by default) on top of the tracker: names sessions and sorts unassigned time.
// Everything is cached in Tempro's kv so the model sees each thing once.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { compileCategories, type AwCategory } from "../engine/categories";
import { appName } from "../engine/context";
import { KIND_LABEL, kindOf as projectKind } from "../engine/rules";
import type { Model, Project, Rule, Segment, Session } from "../engine/types";
import { t } from "../lib/i18n";
import { call } from "./api";
import { useBackend, useSettings } from "./backend";
import { actions, refreshStore, useStore } from "./store";

export function useCategories() {
  const has = useBackend().data;
  const q = useQuery({ queryKey: ["aw_categories"], queryFn: () => call<AwCategory[]>("aw_categories"), enabled: has === true, staleTime: Infinity });
  return useMemo(() => compileCategories(q.data ?? []), [q.data]);
}

/** Session id changes when rules change; a minute-rounded start plus the project is stable enough. */
export const titleKey = (s: Session) => `${s.projectId ?? "none"}|${Math.round(s.start / 60_000)}`;

export function useTitles(model: Model | null): Map<string, string> {
  const { settings, available } = useSettings();
  const qc = useQueryClient();
  const on = available && settings.aiProvider !== "none" && settings.aiTitles;
  const cache = useQuery({ queryKey: ["ui.titles"], queryFn: () => call<Record<string, string> | null>("kv_get", { key: "ui.titles" }), enabled: on, staleTime: Infinity });
  const asking = useRef(false);
  const { projects } = useStore();

  useEffect(() => {
    if (!on || !model || !cache.isSuccess || asking.current) return;
    const known = cache.data ?? {};
    const now = Date.now();
    // only finished sessions worth a name; the live one keeps changing
    const todo = model.sessions.filter((s) => s.active >= 10 * 60_000 && s.end < now - 5 * 60_000 && !known[titleKey(s)]).slice(0, 12);
    if (!todo.length) return;
    asking.current = true;
    const items = todo.map((s) => {
      const tally = new Map<string, { app: string; ms: number }>();
      for (const g of model.segments) {
        if (g.end <= s.start || g.start >= s.end || g.projectId !== s.projectId) continue;
        const k = g.context || appName(g.app);
        const t = tally.get(k) ?? { app: appName(g.app), ms: 0 };
        t.ms += g.end - g.start;
        tally.set(k, t);
      }
      return {
        id: titleKey(s),
        minutes: Math.round(s.active / 60_000),
        project: projects.find((p) => p.id === s.projectId)?.name ?? null,
        items: [...tally.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 8).map(([title, t]) => ({ app: t.app, title, minutes: Math.round(t.ms / 60_000) })),
      };
    });
    call<{ id: string; title: string }[]>("ai_titles", { sessions: items })
      .then(async (res) => {
        const next = { ...known };
        for (const r of res) if (r.title?.trim()) next[r.id] = r.title.trim();
        // ids the model skipped get an empty name so they aren't asked again and again
        for (const i of items) next[i.id] ??= "";
        await call("kv_put", { key: "ui.titles", value: next });
        qc.setQueryData(["ui.titles"], next);
      })
      .catch((e) => console.warn("ai_titles", e))
      .finally(() => (asking.current = false));
  }, [on, model, cache.isSuccess, cache.data, projects, qc]);

  return useMemo(() => {
    const m = new Map<string, string>();
    if (!model) return m;
    for (const s of model.sessions) {
      const t = cache.data?.[titleKey(s)];
      if (t) m.set(s.id, t);
    }
    return m;
  }, [model, cache.data]);
}

/** What a title is, in words the model can use to tell a project folder from a browser tab. */
function kindOf(s: Segment): string {
  const a = s.app.toLowerCase();
  if (s.path) return t("папка Claude Code");
  if (a === "figma.exe") return t("файл Figma");
  if (/^(afterfx|photoshop|illustrator|adobe premiere pro)\.exe$/.test(a)) return t("файл Adobe");
  if (/^(cursor|code)\.exe$/.test(a)) return t("папка редактора");
  if (s.url || /^(msedge|chrome|firefox)\.exe$/.test(a)) return t("вкладка браузера");
  if (/^(telegram|discord|whatsapp|slack)\.exe$/.test(a)) return t("чат");
  return t("окно");
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Bump when the prompt changes: what an older prompt looked at deserves a second look. */
export const SEEN_KEY = "ui.ai_seen.v3";

type Suggestion = { id: string; projectId: string | null; newProject?: string | null; confidence: number; reason: string };

/** Projects the model thinks exist but aren't in the list yet: name → the titles behind it. */
export type NewProjects = Record<string, { minutes: number; items: { app: string; ctx: string; minutes: number }[] }>;

/** Ask the model about unassigned titles it hasn't seen; confident answers become "ai" rules
 *  (applied at once, marked ✨, one click to confirm or undo). */
export async function autoSort(model: Model, projects: Project[], rules: Rule[], minConfidence = 0.8): Promise<number> {
  await refreshStore();
  const seen = (await call<Record<string, number> | null>("kv_get", { key: SEEN_KEY })) ?? {};
  const tally = new Map<string, { app: string; ms: number; ctx: string; kind: string }>();
  for (const s of model.segments) {
    if (s.projectId || s.state === "manual") continue;
    const ctx = s.context || appName(s.app);
    const id = `${s.app}\u0000${ctx}`;
    const t = tally.get(id) ?? { app: s.app, ms: 0, ctx, kind: kindOf(s) };
    t.ms += s.end - s.start;
    tally.set(id, t);
  }
  const items = [...tally.entries()]
    .filter(([id, t]) => t.ms >= 3 * 60_000 && !seen[id])
    .sort((a, b) => b[1].ms - a[1].ms)
    .slice(0, 60)
    .map(([id, t]) => ({ id, app: appName(t.app), kind: t.kind, title: t.ctx, minutes: Math.round(t.ms / 60_000) }));
  if (!items.length) return 0;
  const list = projects
    .filter((p) => !p.archived)
    .map((p) => ({ id: p.id, name: p.name, kind: KIND_LABEL[projectKind(p)].toLowerCase(), hints: rules.filter((r) => r.projectId === p.id).map((r) => r.value).slice(0, 8) }));
  // a model relayed through a proxy takes ~3 s per title: small batches, a few at a time
  const batches: (typeof items)[] = [];
  for (let i = 0; i < items.length; i += 15) batches.push(items.slice(i, i + 15));
  const res: Suggestion[] = [];
  for (let i = 0; i < batches.length; i += 3) {
    const done = await Promise.allSettled(batches.slice(i, i + 3).map((b) => call<Suggestion[]>("ai_suggest", { items: b, projects: list })));
    for (const d of done) if (d.status === "fulfilled") res.push(...d.value);
    if (done.every((d) => d.status === "rejected")) throw (done[0] as PromiseRejectedResult).reason;
  }
  const valid = new Set(list.map((p) => p.id));
  const known = new Set(list.map((p) => norm(p.name)));
  const fresh = (await call<NewProjects | null>("kv_get", { key: "ui.ai_new" })) ?? {};
  let n = 0;
  for (const r of res) {
    const t = tally.get(r.id);
    if (!t) continue;
    if (r.projectId && valid.has(r.projectId) && r.confidence >= minConfidence) {
      actions.addRule(r.projectId, t.ctx === appName(t.app) ? "app" : "context", t.ctx === appName(t.app) ? t.app : t.ctx, "equals", "ai");
      n++;
    } else if (r.newProject?.trim() && r.confidence >= 0.7 && !known.has(norm(r.newProject))) {
      const name = r.newProject.trim();
      // "NimbusApp" and "nimbus-app" are one project
      const key = Object.keys(fresh).find((k) => norm(k) === norm(name)) ?? name;
      const entry = (fresh[key] ??= { minutes: 0, items: [] });
      if (!entry.items.some((i) => i.ctx === t.ctx && i.app === t.app)) {
        entry.items.push({ app: t.app, ctx: t.ctx, minutes: Math.round(t.ms / 60_000) });
        entry.minutes += Math.round(t.ms / 60_000);
      }
    }
  }
  await call("kv_put", { key: "ui.ai_new", value: fresh });
  const next = { ...seen };
  for (const i of items) next[i.id] = Date.now();
  await call("kv_put", { key: SEEN_KEY, value: next });
  return n;
}
