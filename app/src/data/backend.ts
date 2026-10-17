import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ManualKind } from "../engine/types";
import { call, hasBackend } from "./api";

export type Settings = {
  idleSeconds: number;
  hideTitles: string[];
  hideApps: string[];
  importAw: boolean;
  screenshots: "never" | "gaps";
  blindApps: string[];
  ocrMinutes: number;
  aiProvider: "none" | "ollama" | "claude";
  aiModel: string;
  aiKey: string;
  aiBaseUrl: string;
  aiTitles: boolean;
  aiAuto: boolean;
  ollamaUrl: string;
  extPort: number;
  questionMinutes: number;
  hotkey: string;
  /** titles, addresses and screen text older than this are wiped; 0 = keep */
  detailDays: number;
};

export const DEFAULT_SETTINGS: Settings = {
  idleSeconds: 120,
  hideTitles: [],
  hideApps: [],
  importAw: true,
  screenshots: "never",
  blindApps: ["claude.exe", "chatgpt.exe", "orca.exe"],
  ocrMinutes: 5,
  aiProvider: "none",
  aiModel: "",
  aiKey: "",
  aiBaseUrl: "",
  aiTitles: true,
  aiAuto: true,
  ollamaUrl: "http://127.0.0.1:11434",
  extPort: 5601,
  questionMinutes: 15,
  hotkey: "Ctrl+Alt+T",
  detailDays: 30,
};

export type Status = {
  counts: { window: number; windowOwn: number; windowAw: number; afk: number; media: number; browser: number; ocr: number; manual: number; firstOwn: number | null; lastEvent: number | null };
  extLastSeen: number;
  extBrowser: string;
  import: { state?: string; window?: number; afk?: number; message?: string; at?: number };
  sensorsSince: number;
  lastSignal: number;
  paused: boolean;
  autostart: boolean | null;
  dbPath: string;
  encrypted: boolean;
  watchdog?: { state: "ok" | "pending" | "dev" | "error"; message?: string };
  crashes?: string[];
  crashLog?: string;
  awPath: string;
  agentsPath: string;
  now: number;
};

export function useBackend() {
  return useQuery({ queryKey: ["backend"], queryFn: hasBackend, staleTime: Infinity });
}

export function useSettings() {
  const has = useBackend().data;
  const q = useQuery({
    queryKey: ["settings"],
    queryFn: () => call<Settings>("settings_get"),
    enabled: has === true,
    staleTime: Infinity,
  });
  return { settings: { ...DEFAULT_SETTINGS, ...(q.data ?? {}) }, loaded: q.isSuccess, available: has === true };
}

export function useSaveSettings() {
  const qc = useQueryClient();
  const { settings } = useSettings();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => call<Settings>("settings_put", { value: { ...settings, ...patch } }),
    onSuccess: (s) => qc.setQueryData(["settings"], s),
  });
}

export function useStatus() {
  const has = useBackend().data;
  return useQuery({ queryKey: ["status"], queryFn: () => call<Status>("status"), enabled: has === true, refetchInterval: 5000 });
}

/** Manual spans change history: refetch every loaded range. */
export function useManual() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["events"] });
  return {
    add: async (m: { start: number; end: number; kind: ManualKind; projectId: string | null; note?: string }) => {
      const r = await call<{ id: string }>("manual_add", { ...m, note: m.note ?? "" });
      await refresh();
      return r.id;
    },
    end: async (id: string, end: number) => {
      await call("manual_end", { id, end });
      await refresh();
    },
    remove: async (id: string) => {
      await call("manual_remove", { id });
      await refresh();
    },
  };
}
