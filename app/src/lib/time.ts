import { getLang, num, t } from "./i18n";

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(t: number, n: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** Monday-based week, as everyone in Russia counts it. */
export function startOfWeek(t: number): number {
  const d = new Date(startOfDay(t));
  const wd = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - wd);
  return d.getTime();
}

const pad = (n: number) => String(n).padStart(2, "0");

export function clock(t: number): string {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Compact duration: "25 мин", "3,5 ч", "22 ч". */
export function dur(ms: number): string {
  const min = t("мин");
  if (ms < MIN) return ms > 0 ? `<1 ${min}` : "0";
  if (ms < HOUR) return `${Math.round(ms / MIN)} ${min}`;
  const h = ms / HOUR;
  const v = h >= 10 ? Math.round(h) : Math.round(h * 10) / 10;
  return `${num(v)} ${t("ч")}`;
}

/** Number and unit separately, for the big figures. */
export function durParts(ms: number): [string, string] {
  const s = dur(ms);
  const i = s.lastIndexOf(" ");
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
}

const WD_RU = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const WD_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_RU = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const en = () => getLang() === "en";
const WD = () => (en() ? WD_EN : WD_RU);
const MONTHS = () => (en() ? MONTHS_EN : MONTHS_RU);

export const weekday = (t: number) => WD()[new Date(t).getDay()];
export const dayNum = (t: number) => new Date(t).getDate();

/** "17 октября" / "October 17" */
export function dayMonth(t: number): string {
  const d = new Date(t);
  return en() ? `${MONTHS_EN[d.getMonth()]} ${d.getDate()}` : `${d.getDate()} ${MONTHS_RU[d.getMonth()]}`;
}

/** "пт, 16 октября" / "Fri, October 16" */
export const weekdayDate = (t: number) => `${weekday(t)}, ${dayMonth(t)}`;

export function dayTitle(t: number, now = Date.now()): string {
  const d = startOfDay(t);
  const today = startOfDay(now);
  const date = dayMonth(t);
  if (d === today) return `${en() ? "Today" : "Сегодня"}, ${date}`;
  if (d === addDays(today, -1)) return `${en() ? "Yesterday" : "Вчера"}, ${date}`;
  return `${WD()[new Date(t).getDay()].replace(/^./, (c) => c.toUpperCase())}, ${date}`;
}

export function rangeTitle(from: number, to: number): string {
  const a = new Date(from);
  const b = new Date(to - 1);
  const M = MONTHS();
  if (en()) {
    const s = (m: number) => M[m].slice(0, 3);
    if (a.getMonth() === b.getMonth()) return `${s(a.getMonth())} ${a.getDate()}–${b.getDate()}`;
    return `${s(a.getMonth())} ${a.getDate()} – ${s(b.getMonth())} ${b.getDate()}`;
  }
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${M[a.getMonth()]}`;
  return `${a.getDate()} ${M[a.getMonth()]} – ${b.getDate()} ${M[b.getMonth()]}`;
}

export function startOfMonth(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function addMonths(t: number, n: number): number {
  const d = new Date(startOfMonth(t));
  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
}

const MONTHS_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

/** "Октябрь 2026" / "October 2026" */
export const monthTitle = (t: number) => `${(en() ? MONTHS_EN : MONTHS_NOM)[new Date(t).getMonth()]} ${new Date(t).getFullYear()}`;

/** "сентября" (genitive, after a day number) / "September" */
export const monthGen = (t: number) => MONTHS()[new Date(t).getMonth()];
