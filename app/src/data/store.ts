// Projects and rules. Saved in Tempro's SQLite (kv "store"); localStorage only mirrors it for the
// browser dev mode and carries over what the first prototype kept there.
import { useSyncExternalStore } from "react";
import { PALETTE, PALETTE_V1, PERSONAL, seedProjects } from "../engine/rules";
import type { Project, Rule, RuleField } from "../engine/types";
import { call, DEMO, hasBackend } from "./api";

type Data = { projects: Project[]; rules: Rule[]; version: 1 };
const KEY = "tempro.store.v1";

function local(): Data | null {
  if (DEMO) return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Rules from the prototype used "title"; the seed now looks in every field. */
function upgrade(d: Data): Data {
  const rules = d.rules.map((r) => (r.source === "default" && r.field === "title" ? { ...r, field: "any" as RuleField } : r));
  const base = d.projects.some((p) => p.id === PERSONAL.id) ? d.projects : [...d.projects, PERSONAL];
  // the first palette's darkest and lightest colours were unreadable on one of the themes
  const projects = base.map((p) => (PALETTE_V1[p.color?.toLowerCase()] ? { ...p, color: PALETTE_V1[p.color.toLowerCase()] } : p));
  return { ...d, projects, rules };
}

let data: Data = upgrade(local() ?? { ...seedProjects(), version: 1 });
let ready = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pending: typeof saveTimer;
function persist() {
  try {
    // demo projects must not leak into the real browser-mode store
    if (DEMO) throw new Error("demo");
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage full / disabled: the backend copy is the one that matters
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    pending = saveTimer;
    if (await hasBackend()) call("store_put", { value: data }).catch((e) => console.error("store_put", e));
  }, 250);
}

function commit(next: Data) {
  data = next;
  persist();
  emit();
}

/** Load once at startup: the database wins; the first run seeds it from localStorage or defaults. */
export async function loadStore() {
  if (await hasBackend()) {
    try {
      const saved = await call<Data | null>("store_get");
      if (saved && Array.isArray(saved.projects)) data = upgrade(saved);
      else persist();
    } catch (e) {
      console.error("store_get", e);
    }
  }
  ready = true;
  emit();
}

/** Something outside the window (a script, another window) may have rewritten the store: pick it up
 *  when the window comes back and before background writes, unless our own save is still pending. */
export async function refreshStore() {
  if (!ready || saveTimer !== pending || !(await hasBackend())) return;
  try {
    const saved = await call<Data | null>("store_get");
    if (saved && Array.isArray(saved.projects) && JSON.stringify(saved) !== JSON.stringify(data)) {
      data = upgrade(saved);
      emit();
    }
  } catch {
    // keep what we have
  }
}
if (typeof window !== "undefined") window.addEventListener("focus", () => void refreshStore());

export function useStore(): Data {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => data,
  );
}

export const storeReady = () => ready;
/** Projects and rules as they are now, outside React. */
export const storeSnapshot = (): Data => data;

const uid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const actions = {
  addProject(name: string): Project {
    const p: Project = { id: uid("p"), name: name.trim(), color: PALETTE[data.projects.length % PALETTE.length] };
    commit({ ...data, projects: [...data.projects, p] });
    return p;
  },
  updateProject(id: string, patch: Partial<Project>) {
    commit({ ...data, projects: data.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  },
  addRule(projectId: string, field: RuleField, value: string, op: Rule["op"] = "contains", source: Rule["source"] = "user") {
    const v = value.trim();
    if (!v) return;
    // one decision per value: re-assigning replaces the old one
    const rules = data.rules.filter((r) => !(r.source !== "default" && r.field === field && r.value.toLowerCase() === v.toLowerCase()));
    rules.push({ id: uid("r"), projectId, field, op, value: v, source, created: Date.now() });
    commit({ ...data, rules });
  },
  /** an ✨ rule the user agreed with: same rule, now theirs */
  confirmRule(id: string) {
    commit({ ...data, rules: data.rules.map((r) => (r.id === id ? { ...r, source: "user" as const } : r)) });
  },
  removeRule(id: string) {
    commit({ ...data, rules: data.rules.filter((r) => r.id !== id) });
  },
  reset() {
    commit({ ...seedProjects(), version: 1 });
  },
};
