import { isTauri } from "@tauri-apps/api/core";
import { call } from "../data/api";
import type { Project, Session } from "../engine/types";
import { HOUR } from "./time";
import { t } from "./i18n";

const cell = (v: string | number) => {
  const s = String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Semicolons and decimal commas: what Russian Excel expects. */
export function sessionsCsv(sessions: Session[], projects: Map<string, Project>): string {
  const head = [t("Проект"), t("Начало"), t("Конец"), t("Часы"), t("Ставка"), t("Сумма"), t("Чем занимался")];
  const rows = [...sessions]
    .sort((a, b) => a.start - b.start)
    .map((s) => {
      const p = s.projectId ? projects.get(s.projectId) : undefined;
      const hours = s.active / HOUR;
      const rate = p?.rate ?? 0;
      return [
        p?.name ?? t("Без проекта"),
        stamp(s.start),
        stamp(s.end),
        hours.toFixed(2).replace(".", ","),
        rate ? String(rate) : "",
        rate ? (hours * rate).toFixed(2).replace(".", ",") : "",
        s.label,
      ];
    });
  return [head, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
}

export async function saveCsv(name: string, content: string): Promise<string | null> {
  if (isTauri()) {
    const r = await call<{ saved: boolean; path?: string }>("export_csv", { name, content });
    return r.saved ? r.path ?? name : null;
  }
  const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return name;
}
