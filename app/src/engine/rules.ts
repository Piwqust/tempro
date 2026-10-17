import { t } from "../lib/i18n";
import type { Project, ProjectKind, Rule } from "./types";

// every colour keeps at least 3:1 against both the white card and the dark one
export const PALETTE = [
  "#FF5A1F", // orange
  "#8B5CF6", // violet
  "#2F6BFF", // blue
  "#16A06A", // green
  "#E5408A", // pink
  "#C28400", // amber
  "#0E9FA8", // teal
  "#E5484D", // red
  "#6366F1", // indigo
  "#A0764E", // brown
];

/** Colours of the first palette that vanished on one of the themes, and what replaces them. */
export const PALETTE_V1: Record<string, string> = { "#6b17d6": "#8B5CF6", "#e9a800": "#C28400", "#3e3bb8": "#6366F1", "#8a6a4a": "#A0764E" };

// Drafted from ActivityWatch history (docs/01). The user edits these on the Projects screen.
/** Starter projects for a fresh install. Kept empty on purpose: projects come from your own
 *  corrections, the AI's suggestions and «Неразобранное», not from someone else's client list. */
const SEED: { name: string; keys: string[] }[] = [];

/** Not work: games, videos, feeds. Lets "sorted" reach 100% without pretending it's a client. */
export const PERSONAL: Project = { id: "p_personal", name: t("Личное"), color: "#8A8FA3", kind: "personal" };

export const KINDS: ProjectKind[] = ["work", "leisure", "personal", "system"];
export const KIND_LABEL: Record<ProjectKind, string> = { work: t("Работа"), leisure: t("Досуг"), personal: t("Личное"), system: t("Служебное") };
export const KIND_COLOR: Record<ProjectKind, string> = { work: "#2F6BFF", leisure: "#E5408A", personal: "#16A06A", system: "#8A8FA3" };
export const kindOf = (p: Project | undefined): ProjectKind => p?.kind ?? (p?.id === PERSONAL.id ? "personal" : "work");

export function seedProjects(): { projects: Project[]; rules: Rule[] } {
  const projects: Project[] = [];
  const rules: Rule[] = [];
  SEED.forEach((s, i) => {
    const id = `p_${s.name.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
    projects.push({ id, name: s.name, color: PALETTE[i % PALETTE.length] });
    for (const value of s.keys) {
      rules.push({ id: `r_${id}_${value}`, projectId: id, field: "any", op: "contains", value, source: "default", created: 0 });
    }
  });
  projects.push(PERSONAL);
  return { projects, rules };
}

export type Subject = { app: string; title: string; context: string; url?: string; path?: string; screen?: string };
export type Matcher = (s: Subject) => Rule | null;

const RANK: Record<Rule["source"], number> = { user: 0, ai: 1, default: 2 };

export function compileRules(rules: Rule[], projects: Project[]): Matcher {
  const live = new Set(projects.filter((p) => !p.archived).map((p) => p.id));
  // user corrections first, newest first: the latest decision wins
  // broad fallback rules go last, after the built-in keywords, so "aurora" in a YouTube title still wins
  const ordered = rules
    .filter((r) => live.has(r.projectId) && r.value.trim())
    .sort((a, b) => +!!a.fallback - +!!b.fallback || RANK[a.source] - RANK[b.source] || b.created - a.created)
    .map((r) => ({ r, v: r.value.toLowerCase() }));

  return (s) => {
    const f = {
      app: s.app.toLowerCase(),
      title: s.title.toLowerCase(),
      context: s.context.toLowerCase(),
      url: (s.url ?? "").toLowerCase(),
      path: (s.path ?? "").toLowerCase(),
    };
    let any: string | null = null;
    // built-in keywords compete: "Kite.Studio × aurora.team" belongs to whoever is named first
    let fallback: { r: Rule; at: number } | null = null;
    for (const { r, v } of ordered) {
      const hay = r.field === "any" ? (any ??= [f.title, f.context, f.url, f.path, (s.screen ?? "").toLowerCase()].join("\n")) : f[r.field];
      const at = r.op === "equals" ? (hay === v ? 0 : -1) : hay.indexOf(v);
      if (at < 0) continue;
      if (r.fallback) return fallback?.r ?? r;
      if (r.source !== "default") return r;
      if (!fallback || at < fallback.at) fallback = { r, at };
    }
    return fallback?.r ?? null;
  };
}

/** Time per kind; time without a project is its own bucket. */
export function kindTotals(byProject: Map<string | null, number>, projects: Map<string, Project>): Map<ProjectKind | null, number> {
  const out = new Map<ProjectKind | null, number>();
  for (const [id, ms] of byProject) {
    const k = id === null ? null : projects.has(id) ? kindOf(projects.get(id)) : null;
    out.set(k, (out.get(k) ?? 0) + ms);
  }
  return out;
}
