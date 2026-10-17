import { describe, expect, test } from "bun:test";
import { emptyDay, summarize } from "../engine/summary";
import type { Model, Project } from "../engine/types";
import { period, periodTitle, previous, step } from "./period";
import { startOfDay } from "./time";

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

describe("periods", () => {
  test("3 months end with the picked month", () => {
    const p = period("quarter", at(2026, 10, 17));
    expect(p.from).toBe(at(2026, 8, 1));
    expect(p.to).toBe(at(2026, 11, 1));
    expect(periodTitle("quarter", p.from, p.to)).toBe("Авг – окт 2026");
    expect(periodTitle("quarter", at(2025, 12, 1), at(2026, 3, 1))).toBe("Дек 2025 – фев 2026");
  });

  test("stepping into the current period lands on today", () => {
    const now = at(2026, 10, 17, 15);
    expect(step("year", at(2025, 3, 10), 1, now)).toBe(at(2026, 10, 17));
    expect(step("month", at(2026, 10, 17), -1, now)).toBe(at(2026, 9, 1));
    // the future is clamped: there is nothing to show there
    expect(step("week", at(2026, 10, 17), 1, now)).toBe(at(2026, 10, 17));
  });

  test("a running period is compared with as many days of the one before", () => {
    const now = at(2026, 10, 17, 15);
    const p = period("quarter", now);
    const prev = previous("quarter", p.from, p.to, now);
    expect(prev.from).toBe(at(2026, 5, 1));
    expect(prev.partial).toBe(true);
    // Aug 1 – Oct 17 is 78 days; May 1 + 78 days is Jul 18
    expect(prev.to).toBe(at(2026, 7, 18));
    const done = previous("month", at(2026, 9, 1), at(2026, 10, 1), now);
    expect(done).toEqual({ from: at(2026, 8, 1), to: at(2026, 9, 1), partial: false });
  });
});

describe("day summaries", () => {
  const projects = new Map<string, Project>([["p", { id: "p", name: "P", color: "#000", kind: "work" } as Project]]);
  const model = (segments: Partial<Model["segments"][number]>[], sessions: Partial<Model["sessions"][number]>[] = []) =>
    ({ segments: segments.map((s) => ({ app: "a", title: "", context: "", projectId: "p", state: "work", ...s })), sessions } as unknown as Model);

  test("a segment over midnight is split between the two days and their hours", () => {
    const m = model([{ start: at(2026, 10, 1, 23, 30), end: at(2026, 10, 2, 0, 45) }]);
    const days = summarize(m, projects, startOfDay);
    const a = days.get(at(2026, 10, 1))!;
    const b = days.get(at(2026, 10, 2))!;
    expect(a.active).toBe(30 * 60_000);
    expect(b.active).toBe(45 * 60_000);
    expect(a.hours.work![23]).toBe(30 * 60_000);
    expect(b.hours.work![0]).toBe(45 * 60_000);
    expect(b.byProject.get("p")).toBe(45 * 60_000);
  });

  test("the longest session is kept per day", () => {
    const m = model(
      [{ start: at(2026, 10, 1, 9), end: at(2026, 10, 1, 12) }],
      [
        { start: at(2026, 10, 1, 9), end: at(2026, 10, 1, 10), active: 3_600_000, projectId: "p", label: "short" },
        { start: at(2026, 10, 1, 10), end: at(2026, 10, 1, 12), active: 7_200_000, projectId: "p", label: "long" },
      ],
    );
    const d = summarize(m, projects, startOfDay).get(at(2026, 10, 1))!;
    expect(d.sessions).toBe(2);
    expect(d.longest?.label).toBe("long");
    expect(emptyDay(0).active).toBe(0);
  });
});
