import type { Screen } from "../nav";
import { addDays, addMonths, DAY, rangeTitle, startOfDay, startOfMonth, startOfWeek } from "./time";

/** How long a stretch the screen shows. "quarter" is three months ending with the picked one,
 *  not a calendar quarter: "the last three months" is what people mean. */
export type Gran = "day" | "week" | "month" | "quarter" | "year";

export const GRANS: Gran[] = ["day", "week", "month", "quarter", "year"];
export const GRAN_LABEL: Record<Gran, string> = { day: "День", week: "Неделя", month: "Месяц", quarter: "3 месяца", year: "Год" };
export const GRAN_KEY: Record<Gran, string> = { day: "d", week: "w", month: "m", quarter: "q", year: "y" };

const SCREEN: Record<Gran, Screen> = { day: "today", week: "week", month: "month", quarter: "quarter", year: "year" };
export const screenOf = (g: Gran): Screen => SCREEN[g];
export const granOf = (s: Screen): Gran | null => (Object.keys(SCREEN) as Gran[]).find((g) => SCREEN[g] === s) ?? null;

export function startOfYear(t: number): number {
  return new Date(new Date(t).getFullYear(), 0, 1).getTime();
}

export function period(g: Gran, day: number): { from: number; to: number } {
  switch (g) {
    case "day":
      return { from: startOfDay(day), to: addDays(startOfDay(day), 1) };
    case "week": {
      const from = startOfWeek(day);
      return { from, to: addDays(from, 7) };
    }
    case "month": {
      const from = startOfMonth(day);
      return { from, to: addMonths(from, 1) };
    }
    case "quarter": {
      const end = addMonths(startOfMonth(day), 1);
      return { from: addMonths(end, -3), to: end };
    }
    case "year": {
      const from = startOfYear(day);
      return { from, to: new Date(new Date(from).getFullYear() + 1, 0, 1).getTime() };
    }
  }
}

/** The day to land on n periods away. Landing in the period that holds today means today:
 *  switching to "День" right after should show today, not the 1st. */
export function step(g: Gran, day: number, n: number, now = Date.now()): number {
  let d: number;
  if (g === "day") d = addDays(day, n);
  else if (g === "week") d = addDays(startOfWeek(day), 7 * n);
  else d = addMonths(startOfMonth(day), n * (g === "month" ? 1 : g === "quarter" ? 3 : 12));
  const p = period(g, d);
  const today = startOfDay(now);
  return today >= p.from && today < p.to ? today : Math.min(d, today);
}

export const isCurrent = (g: Gran, day: number, now = Date.now()) => now < period(g, day).to;

const MONTH_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
export const monthShort = (t: number) => MONTH_SHORT[new Date(t).getMonth()];

export function periodTitle(g: Gran, from: number, to: number): string {
  const a = new Date(from);
  const b = new Date(to - 1);
  if (g === "year") return String(a.getFullYear());
  if (g === "quarter") {
    const left = MONTH_SHORT[a.getMonth()] + (a.getFullYear() !== b.getFullYear() ? ` ${a.getFullYear()}` : "");
    return `${left} – ${MONTH_SHORT[b.getMonth()]} ${b.getFullYear()}`.replace(/^./, (c) => c.toUpperCase());
  }
  return rangeTitle(from, to);
}

/** The same stretch right before, cut to as many days as have passed of the current one:
 *  half a quarter is compared with the first half of the previous quarter, not all of it. */
export function previous(g: Gran, from: number, to: number, now = Date.now()): { from: number; to: number; partial: boolean } {
  // any day inside the period before will do; for 3 months that is the month right before `from`
  const p = period(g, g === "day" ? addDays(from, -1) : g === "week" ? addDays(from, -7) : addMonths(from, g === "year" ? -12 : -1));
  if (now >= to) return { ...p, partial: false };
  const elapsed = Math.round((addDays(startOfDay(now), 1) - from) / DAY);
  return { from: p.from, to: Math.min(p.to, addDays(p.from, elapsed)), partial: true };
}

/** Every day start in [from, to). */
export function daysIn(from: number, to: number): number[] {
  const out: number[] = [];
  for (let d = startOfDay(from); d < to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Month starts that overlap [from, to). */
export function monthsIn(from: number, to: number): number[] {
  const out: number[] = [];
  for (let m = startOfMonth(from); m < to; m = addMonths(m, 1)) out.push(m);
  return out;
}
