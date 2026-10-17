// Two languages, Russian (the source) and English. Strings are written in Russian in the code and
// looked up in the English dictionaries (src/i18n/en.*.ts); a missing entry falls back to Russian.
// The language is chosen once at startup; changing it reloads the window.
import { Fragment, createElement, type ReactNode } from "react";
import { EN_A } from "../i18n/en.a";
import { EN_B } from "../i18n/en.b";
import { EN_C } from "../i18n/en.c";
import { EN_CORE } from "../i18n/en.core";

export type Lang = "ru" | "en";
export type LangSetting = Lang | "auto";

const KEY = "tempro.lang";

function stored(): LangSetting {
  try {
    const v = localStorage.getItem(KEY);
    return v === "ru" || v === "en" ? v : "auto";
  } catch {
    return "auto";
  }
}

function detect(): Lang {
  // tests and other non-browser runs read the Russian source as is
  if (typeof window === "undefined" || typeof localStorage === "undefined") return "ru";
  const q = new URLSearchParams(location.search).get("lang");
  if (q === "ru" || q === "en") return q;
  const s = stored();
  if (s !== "auto") return s;
  return (navigator.language || "ru").toLowerCase().startsWith("ru") ? "ru" : "en";
}

let lang: Lang = detect();
const EN: Record<string, string> = { ...EN_C, ...EN_B, ...EN_A, ...EN_CORE };

export const getLang = (): Lang => lang;
export const langSetting = (): LangSetting => stored();
/** BCP 47 tag for Intl and toLocale* calls */
export const locale = (): string => (lang === "en" ? "en-US" : "ru-RU");

/** Remember the choice and reload: every label, date and number is formatted at render. */
export function setLang(l: LangSetting, reload = true) {
  try {
    if (l === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, l);
  } catch {
    // private mode: the choice lasts until the window closes
  }
  const next = l === "auto" ? ((navigator.language || "ru").toLowerCase().startsWith("ru") ? "ru" : "en") : l;
  if (next !== lang && reload) location.reload();
  lang = next;
}

/** Test hook: switch without touching storage or reloading. */
export const _setLangForTests = (l: Lang) => void (lang = l);

type Params = Record<string, string | number>;

/** t("Сегодня") → "Today"; t("{n} дней", { n: 3 }) → "3 days" */
export function t(ru: string, params?: Params): string {
  let s = lang === "en" ? (EN[ru] ?? ru) : ru;
  if (params) s = s.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`));
  return s;
}

/** Like t, but placeholders can be elements: tj("{h} работы", { h: <b>3 ч</b> }). */
export function tj(ru: string, parts: Record<string, ReactNode>): ReactNode {
  const s = lang === "en" ? (EN[ru] ?? ru) : ru;
  const out: ReactNode[] = [];
  let last = 0;
  s.replace(/\{(\w+)\}/g, (m, k: string, at: number) => {
    out.push(s.slice(last, at));
    out.push(k in parts ? createElement(Fragment, { key: `${k}${at}` }, parts[k]) : m);
    last = at + m.length;
    return m;
  });
  out.push(s.slice(last));
  return createElement(Fragment, null, ...out);
}

/** Plural forms: pl(5, ["сессия", "сессии", "сессий"], ["session", "sessions"]) → "сессий" / "sessions" */
export function pl(n: number, ru: [string, string, string], en: [string, string]): string {
  if (lang === "en") return Math.abs(n) === 1 ? en[0] : en[1];
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return ru[2];
  if (b > 1 && b < 5) return ru[1];
  if (b === 1) return ru[0];
  return ru[2];
}

/** Decimal separator of the language: "3,5" / "3.5". */
export const num = (v: number | string): string => (lang === "en" ? String(v) : String(v).replace(".", ","));
