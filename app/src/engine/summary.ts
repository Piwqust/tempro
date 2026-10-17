import { SHORT_SESSION_MS } from "./compute";
import { kindOf } from "./rules";
import type { Model, Project, ProjectKind } from "./types";

const HOUR = 3_600_000;

export type HourKey = ProjectKind | "none";

/** One day reduced to what long periods (3 months, a year) need: a year of raw events doesn't
 *  fit in a page, a year of these does. */
export type DaySum = {
  day: number;
  active: number;
  byProject: Map<string | null, number>;
  /** ms per clock hour, by kind of project */
  hours: Partial<Record<HourKey, number[]>>;
  first: number | null;
  last: number | null;
  /** sessions long enough to count, by the day they started */
  sessions: number;
  longest: { start: number; end: number; active: number; projectId: string | null; label: string } | null;
  watch: number;
  call: number;
};

export const emptyDay = (day: number): DaySum => ({ day, active: 0, byProject: new Map(), hours: {}, first: null, last: null, sessions: 0, longest: null, watch: 0, call: 0 });

/** dayStart(t) for the local calendar, injected so tests don't depend on the machine's zone */
export function summarize(model: Model, projects: Map<string, Project>, dayStart: (t: number) => number): Map<number, DaySum> {
  const out = new Map<number, DaySum>();
  const at = (d: number) => {
    let s = out.get(d);
    if (!s) out.set(d, (s = emptyDay(d)));
    return s;
  };
  const kind = (id: string | null): HourKey => (id && projects.has(id) ? kindOf(projects.get(id)) : "none");

  for (const seg of model.segments) {
    // split at midnights and clock hours: a segment from 23:50 to 00:20 belongs to two days
    let t = seg.start;
    while (t < seg.end) {
      const d = dayStart(t);
      // a local day is 23–25 hours long, so 26 hours on always lands in the next one
      const next = Math.min(seg.end, d + (Math.floor((t - d) / HOUR) + 1) * HOUR, dayStart(d + 26 * HOUR));
      const ms = next - t;
      const s = at(d);
      s.active += ms;
      s.byProject.set(seg.projectId, (s.byProject.get(seg.projectId) ?? 0) + ms);
      const k = kind(seg.projectId);
      const h = Math.min(23, Math.floor((t - d) / HOUR));
      (s.hours[k] ??= new Array(24).fill(0))[h] += ms;
      if (seg.state === "watch") s.watch += ms;
      if (seg.state === "call") s.call += ms;
      s.first = s.first === null ? t : Math.min(s.first, t);
      s.last = s.last === null ? next : Math.max(s.last, next);
      t = next;
    }
  }

  for (const ses of model.sessions) {
    if (ses.active < SHORT_SESSION_MS) continue;
    const s = at(dayStart(ses.start));
    s.sessions++;
    if (!s.longest || ses.active > s.longest.active) s.longest = { start: ses.start, end: ses.end, active: ses.active, projectId: ses.projectId, label: ses.label };
  }
  return out;
}

