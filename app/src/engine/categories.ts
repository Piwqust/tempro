// "Kind of activity" from ActivityWatch's own categories (Work / Media / Comms …), imported with its settings.
import { t } from "../lib/i18n";
import type { Segment } from "./types";

export type AwCategory = { name: string[]; regex: string; ignoreCase: boolean };

const LABEL: Record<string, string> = { Work: t("Работа"), Media: t("Медиа"), Comms: t("Общение") };
export const CATEGORY_COLOR: Record<string, string> = {
  [t("Работа")]: "#2F6BFF",
  [t("Медиа")]: "#E5408A",
  [t("Общение")]: "#16A06A",
  [t("Прочее")]: "#9a9a9a",
};

export type Categorizer = (app: string, title: string) => string;

// ActivityWatch's stock list knows GIMP and Kdenlive but not Figma or Claude; these fill the gap.
// They come after AW's own rules, so the user's AW categories still win.
// Order matters: a YouTube video about Claude is a video, a Telegram chat about Figma is a chat.
const BUILT_IN: AwCategory[] = [
  { name: ["Media", "Games"], regex: "deadlock|steam|dota|cs2|valorant|Epic Games", ignoreCase: true },
  { name: ["Media", "Video"], regex: "YouTube|Twitch|Netflix|Кинопоиск|Rutube|VK Видео|Media viewer", ignoreCase: true },
  { name: ["Media", "Social"], regex: "Instagram|TikTok|Pinterest|Threads|Twitter|ВКонтакте| / X$", ignoreCase: true },
  { name: ["Comms"], regex: "Telegram|Discord|WhatsApp|Slack|Zoom|Teams|Gmail|Outlook|Почта", ignoreCase: true },
  { name: ["Work", "Design"], regex: "Figma|AfterFX|After Effects|Photoshop|Illustrator|Premiere|Blender|TouchDesigner|Spline|Framer", ignoreCase: true },
  { name: ["Work", "Code"], regex: "Cursor|Code\\.exe|Visual Studio|WindowsTerminal|Orca|github\\.com|localhost", ignoreCase: true },
  { name: ["Work", "AI"], regex: "ChatGPT|Claude|Gemini|Perplexity", ignoreCase: true },
];

export function compileCategories(list: AwCategory[]): Categorizer {
  const compile = (c: AwCategory) => {
    try {
      return { re: new RegExp(c.regex, c.ignoreCase ? "i" : ""), top: c.name[0], depth: c.name.length };
    } catch {
      return null;
    }
  };
  // ActivityWatch's own rules first (deepest match wins, as there), then the built-in ones in order
  const aw = list.map(compile).filter((r): r is NonNullable<typeof r> => !!r).sort((a, b) => b.depth - a.depth);
  const rules = [...aw, ...BUILT_IN.map(compile).filter((r): r is NonNullable<typeof r> => !!r)];
  return (app, title) => {
    for (const r of rules) if (r.re.test(title) || r.re.test(app)) return LABEL[r.top] ?? r.top;
    return t("Прочее");
  };
}

export function categoryTotals(segments: Segment[], cat: Categorizer): [string, number][] {
  const m = new Map<string, number>();
  for (const s of segments) {
    if (s.state === "manual") continue;
    const k = cat(s.app, s.title);
    m.set(k, (m.get(k) ?? 0) + (s.end - s.start));
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
