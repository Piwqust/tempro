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
  if (ms < MIN) return ms > 0 ? "<1 мин" : "0";
  if (ms < HOUR) return `${Math.round(ms / MIN)} мин`;
  const h = ms / HOUR;
  const v = h >= 10 ? Math.round(h) : Math.round(h * 10) / 10;
  return `${String(v).replace(".", ",")} ч`;
}

/** Number and unit separately, for the big figures. */
export function durParts(ms: number): [string, string] {
  const s = dur(ms);
  const i = s.lastIndexOf(" ");
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
}

const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export const weekday = (t: number) => WD[new Date(t).getDay()];
export const dayNum = (t: number) => new Date(t).getDate();

export function dayTitle(t: number, now = Date.now()): string {
  const d = startOfDay(t);
  const today = startOfDay(now);
  const date = `${new Date(t).getDate()} ${MONTHS[new Date(t).getMonth()]}`;
  if (d === today) return `Сегодня, ${date}`;
  if (d === addDays(today, -1)) return `Вчера, ${date}`;
  return `${WD[new Date(t).getDay()].replace(/^./, (c) => c.toUpperCase())}, ${date}`;
}

export function rangeTitle(from: number, to: number): string {
  const a = new Date(from);
  const b = new Date(to - 1);
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MONTHS[a.getMonth()]}`;
  return `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
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

/** "Октябрь 2026" */
export const monthTitle = (t: number) => `${MONTHS_NOM[new Date(t).getMonth()]} ${new Date(t).getFullYear()}`;

/** "сентября" */
export const monthGen = (t: number) => MONTHS[new Date(t).getMonth()];
