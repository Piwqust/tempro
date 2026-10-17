import { CalendarDays, CalendarFold, CalendarRange, ChartColumnBig, ChevronDown, ChevronLeft, ChevronRight, Grid3x3 } from "lucide-react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useDaySums } from "../data/daysum";
import { KIND_COLOR, kindTotals } from "../engine/rules";
import { useProjects } from "../data/useModel";
import { GRAN_KEY, GRAN_LABEL, GRANS, isCurrent, monthShort, period, periodTitle, screenOf, startOfYear, step, type Gran } from "../lib/period";
import { addDays, addMonths, dayNum, dayTitle, dur, monthTitle, startOfDay, startOfMonth, startOfWeek } from "../lib/time";
import { useNav } from "../nav";
import { Popover } from "./Popover";
import { TopBar } from "./TopBar";

export const GRAN_ICON: Record<Gran, (size: number) => ReactNode> = {
  day: (s) => <CalendarDays size={s} strokeWidth={1.75} />,
  week: (s) => <CalendarRange size={s} strokeWidth={1.75} />,
  month: (s) => <CalendarFold size={s} strokeWidth={1.75} />,
  quarter: (s) => <ChartColumnBig size={s} strokeWidth={1.75} />,
  year: (s) => <Grid3x3 size={s} strokeWidth={1.75} />,
};

/** The top bar of every period screen: step back and forth, jump anywhere from the calendar. */
export function PeriodBar({ gran, right }: { gran: Gran; right?: ReactNode }) {
  const { nav, go } = useNav();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const { from, to } = period(gran, nav.day);
  const current = isCurrent(gran, nav.day);
  const title = gran === "day" ? dayTitle(nav.day) : gran === "month" ? monthTitle(from) : periodTitle(gran, from, to);

  return (
    <TopBar
      icon={GRAN_ICON[gran](14)}
      section={GRAN_LABEL[gran]}
      onPrev={() => go({ day: step(gran, nav.day, -1) })}
      onNext={() => go({ day: step(gran, nav.day, 1) })}
      nextDisabled={current}
      title={
        <>
          <button type="button" ref={setAnchor} className="pb-date" data-open={open || undefined} onClick={() => setOpen((o) => !o)} title="Выбрать дату">
            {title}
            <ChevronDown size={14} />
          </button>
          <Popover anchor={anchor} open={open} onClose={() => setOpen(false)}>
            <DatePicker
              gran={gran}
              day={nav.day}
              onPick={(g, d) => {
                go({ screen: screenOf(g), day: d });
                setOpen(false);
              }}
            />
          </Popover>
        </>
      }
      right={
        <>
          {!current && (
            <button type="button" className="btn btn-ghost-white" onClick={() => go({ day: startOfDay(Date.now()) })} title="Сегодня  T">
              {gran === "day" ? "К сегодня" : "К текущему"}
            </button>
          )}
          {right}
        </>
      }
    />
  );
}

type Preset = { label: string; gran: Gran; day: number };

function presets(now: number): Preset[] {
  const today = startOfDay(now);
  return [
    { label: "Сегодня", gran: "day", day: today },
    { label: "Вчера", gran: "day", day: addDays(today, -1) },
    { label: "Эта неделя", gran: "week", day: today },
    { label: "Прошлая неделя", gran: "week", day: addDays(startOfWeek(today), -7) },
    { label: "Этот месяц", gran: "month", day: today },
    { label: "Прошлый месяц", gran: "month", day: addMonths(today, -1) },
    { label: "Последние 3 месяца", gran: "quarter", day: today },
    { label: "Этот год", gran: "year", day: today },
    { label: "Прошлый год", gran: "year", day: new Date(new Date(today).getFullYear() - 1, 0, 1).getTime() },
  ];
}

const WD = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

/** Presets on the left; on the right a month of days (day, week) or a year of months (longer
 *  periods), each tinted by how much work it held, so the busy stretches are visible before
 *  the click. Hovering shows the stretch a click would open. */
function DatePicker({ gran, day, onPick }: { gran: Gran; day: number; onPick: (g: Gran, day: number) => void }) {
  const now = Date.now();
  const today = startOfDay(now);
  const byMonth = gran === "month" || gran === "quarter" || gran === "year";
  const [view, setView] = useState(() => (byMonth ? startOfYear(day) : startOfMonth(day)));
  const [hover, setHover] = useState<number | null>(null);
  const viewEnd = byMonth ? new Date(new Date(view).getFullYear() + 1, 0, 1).getTime() : addMonths(view, 1);
  const { days } = useDaySums(view, viewEnd);
  const projects = useProjects();

  const work = useMemo(() => {
    const m = new Map<number, number>();
    for (const d of days) {
      const w = kindTotals(d.byProject, projects).get("work") ?? 0;
      const key = byMonth ? startOfMonth(d.day) : d.day;
      m.set(key, (m.get(key) ?? 0) + w);
    }
    return m;
  }, [days, projects, byMonth]);
  const max = Math.max(1, ...work.values());
  const level = (ms: number) => (ms <= 0 ? 0 : Math.max(1, Math.ceil((ms / max) * 4)));

  const sel = period(gran, day);
  const pre = hover !== null ? period(gran, hover) : null;
  const inside = (t: number, p: { from: number; to: number } | null) => !!p && t >= p.from && t < p.to;
  const pick = (t: number) => onPick(gran, Math.min(t, today));

  const cells = useMemo(() => {
    if (byMonth) return Array.from({ length: 12 }, (_, i) => addMonths(view, i));
    const first = startOfWeek(view);
    return Array.from({ length: 42 }, (_, i) => addDays(first, i)).filter((d, i) => i < 35 || d < addMonths(view, 1));
  }, [view, byMonth]);

  return (
    <div className="dp">
      <div className="dp-presets">
        {presets(now).map((p) => {
          const pp = period(p.gran, p.day);
          const on = p.gran === gran && pp.from === sel.from;
          return (
            <button key={p.label} type="button" data-on={on || undefined} onClick={() => onPick(p.gran, p.day)}>
              {p.label}
            </button>
          );
        })}
        <span className="dp-keys">
          ← → листать · T сегодня
          <br />
          {GRANS.map((g) => GRAN_KEY[g].toUpperCase()).join(" ")} — день … год
        </span>
      </div>
      <div className="dp-cal">
        <header className="dp-head">
          <button type="button" className="icon-btn" onClick={() => setView(byMonth ? new Date(new Date(view).getFullYear() - 1, 0, 1).getTime() : addMonths(view, -1))} aria-label="Раньше">
            <ChevronLeft size={16} />
          </button>
          <span>{byMonth ? new Date(view).getFullYear() : monthTitle(view)}</span>
          <button type="button" className="icon-btn" disabled={viewEnd > now} onClick={() => setView(byMonth ? viewEnd : addMonths(view, 1))} aria-label="Позже">
            <ChevronRight size={16} />
          </button>
        </header>
        {!byMonth && (
          <div className="dp-wd">
            {WD.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
        )}
        <div className="dp-grid" data-months={byMonth || undefined} onPointerLeave={() => setHover(null)}>
          {cells.map((t) => {
            const future = t > today;
            const out = !byMonth && (t < view || t >= addMonths(view, 1));
            const ms = work.get(t) ?? 0;
            return (
              <button
                key={t}
                type="button"
                className="dp-cell"
                disabled={future}
                data-out={out || undefined}
                data-today={(byMonth ? t === startOfMonth(today) : t === today) || undefined}
                data-sel={inside(t, sel) || undefined}
                data-pre={inside(t, pre) || undefined}
                style={{ "--l": level(ms), "--c": KIND_COLOR.work } as CSSProperties}
                title={ms ? `работа ${dur(ms)}` : undefined}
                onPointerEnter={() => !future && setHover(t)}
                onClick={() => pick(t)}
              >
                {byMonth ? (
                  <>
                    <b>{monthShort(t)}</b>
                    <small>{ms ? dur(ms) : ""}</small>
                  </>
                ) : (
                  dayNum(t)
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
