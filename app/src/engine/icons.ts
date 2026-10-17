import type { Project, ProjectKind, Rule } from "./types";

/** Every icon a project can wear; names are keys of the map in ui/ProjectIcon.tsx. */
export const ICONS = [
  "palette", "layout-template", "pen-tool", "brush", "clapperboard", "image", "camera",
  "code", "terminal", "bot", "sparkles", "cpu", "database", "globe", "smartphone",
  "message-circle", "send", "mail", "at-sign", "video", "file-text", "newspaper", "book-open", "graduation-cap",
  "briefcase", "building-2", "wallet", "shopping-bag", "clock", "lightbulb", "puzzle", "shield",
  "play", "tv", "popcorn", "radio", "gamepad-2", "trophy", "dices", "spade", "music", "headphones",
  "user", "heart-pulse", "dumbbell", "utensils", "plane", "coffee", "settings",
  "box", "layers", "rocket", "hexagon", "target", "zap", "star", "gem", "leaf", "flame", "compass", "anchor", "mountain", "feather",
] as const;
export type IconName = (typeof ICONS)[number];

// JS's \b only knows Latin letters: "тг" would never be a word. A Unicode word boundary instead.
const B = String.raw`(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))`;
const re = (r: RegExp) => new RegExp(r.source.replaceAll("\\b", B), "u");

/** Checked in order against the project name, then against what its rules look for. */
const KEYWORDS: [RegExp, IconName][] = ([
  [/tempro|трекер|учёт времени|time ?track/, "clock"],
  [/моушн|motion|after ?effects|анимац|монтаж|premiere|davinci/, "clapperboard"],
  [/лендинг|landing|сайт|site|web|веб/, "layout-template"],
  [/figma|дизайн|design|макет|\bui\b|\bux\b|иллюстр|логотип|бренд/, "palette"],
  [/референс|pinterest|мудборд|moodboard|behance|dribbble|вдохнов/, "image"],
  [/фото|photo|lightroom|photoshop/, "camera"],
  [/стрим|twitch|stream|трансляц/, "radio"],
  [/видео|youtube|ролик|кино|фильм|сериал|netflix|аниме/, "play"],
  [/покер|poker|казино|casino|ставк|\bbet\b|bet$/, "spade"],
  [/игр|game|steam|deadlock|dota|cs2|valorant|roblox|minecraft|epic games/, "gamepad-2"],
  [/музык|music|spotify|soundcloud|плейлист|подкаст|podcast/, "music"],
  [/\bии\b|ии-|\bai\b|gpt|claude|нейро|llm|генерац|midjourney/, "sparkles"],
  [/telegram|телеграм|^тг\b|^tg\b/, "send"],
  [/чат|chat|whatsapp|discord|переписк|мессенд|messenger|slack/, "message-circle"],
  [/почт|mail|gmail|outlook/, "mail"],
  [/соцсет|instagram|twitter|x\.com|tiktok|\bvk\b|вконтакте|reddit|threads/, "at-sign"],
  [/\bбот|\bbot/, "bot"],
  [/код|\bcode|\bdev|github|агент|agent|cursor|vscode|программ|скрипт|script/, "code"],
  [/терминал|terminal|сервер|server|devops|docker/, "terminal"],
  [/приложени|\bapp\b|mobile|ios|android/, "smartphone"],
  [/покупк|shop|магазин|ozon|wildberries|market|заказ/, "shopping-bag"],
  [/учёб|учеб|курс|study|learn|обучен|лекци|школ|универ/, "graduation-cap"],
  [/книг|book|чтени|reading/, "book-open"],
  [/новост|news|стать/, "newspaper"],
  [/финанс|банк|bank|деньг|крипт|crypto|trading|инвест|налог/, "wallet"],
  [/заметк|notes|notion|obsidian|документ|docs|текст|пишу|writing/, "file-text"],
  [/созвон|встреч|meet|zoom|call|звонк/, "video"],
  [/студи|studio|агентств|agency|клиент/, "building-2"],
  [/спорт|gym|трениров|фитнес/, "dumbbell"],
  [/еда|food|рецепт|готов/, "utensils"],
  [/путешеств|travel|билет|отпуск/, "plane"],
  [/здоров|health|врач|медиц/, "heart-pulse"],
  [/служебн|систем|system|настройк|обновлен|update/, "settings"],
  [/личн|personal/, "user"],
] as [RegExp, IconName][]).map(([r, i]) => [re(r), i]);

/** Projects without a telling name still get a glyph of their own, not a row of briefcases. */
const POOL: Record<ProjectKind, IconName[]> = {
  work: ["box", "layers", "rocket", "hexagon", "target", "zap", "star", "gem", "leaf", "flame", "compass", "anchor", "mountain", "feather", "puzzle", "lightbulb"],
  leisure: ["coffee", "popcorn", "tv", "headphones", "dices", "trophy"],
  personal: ["user", "heart-pulse", "leaf", "feather"],
  system: ["settings", "shield", "cpu"],
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** The icon a project gets when nobody picked one: by name, then by its rules, then by kind. */
export function autoIcon(p: Project, rules: Rule[] = []): IconName {
  const name = p.name.toLowerCase();
  for (const [re, icon] of KEYWORDS) if (re.test(name)) return icon;
  const looks = rules
    .filter((r) => r.projectId === p.id)
    .map((r) => r.value.toLowerCase())
    .join("\n");
  if (looks) for (const [re, icon] of KEYWORDS) if (re.test(looks)) return icon;
  const kind: ProjectKind = p.kind ?? (p.id === "p_personal" ? "personal" : "work");
  const pool = POOL[kind];
  return pool[hash(p.id) % pool.length];
}

export const iconOf = (p: Project, rules: Rule[] = []): IconName => (p.icon && (ICONS as readonly string[]).includes(p.icon) ? (p.icon as IconName) : autoIcon(p, rules));
