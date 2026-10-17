import { expect, test } from "bun:test";
import { autoIcon, iconOf } from "./icons";
import type { Project, Rule } from "./types";

const p = (name: string, extra: Partial<Project> = {}): Project => ({ id: `p_${name}`, name, color: "#000", ...extra });
const rule = (projectId: string, value: string): Rule => ({ id: value, projectId, field: "any", op: "contains", value, source: "user", created: 0 });

test("icons come from the name, then the rules, then the kind", () => {
  expect(autoIcon(p("Дизайн и моушн: разное"))).toBe("clapperboard");
  expect(autoIcon(p("ТГ"))).toBe("send");
  expect(autoIcon(p("Игры", { kind: "leisure" }))).toBe("gamepad-2");
  expect(autoIcon(p("ИИ-чаты и генерация"))).toBe("sparkles");
  // a client name says nothing; its rules do
  expect(autoIcon(p("aurora"), [rule("p_aurora", "figma.com/design/aurora")])).toBe("palette");
  // nothing at all: a stable glyph from the kind's pool
  const a = autoIcon(p("orbit"));
  expect(autoIcon(p("orbit"))).toBe(a);
});

test("a picked icon wins, an unknown one falls back", () => {
  expect(iconOf(p("aurora", { icon: "rocket" }))).toBe("rocket");
  expect(iconOf(p("Музыка", { icon: "no-such-icon" }))).toBe("music");
});
