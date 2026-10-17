// What document / tab / chat the window shows, extracted from the title.
// This is the strongest project signal we have until the browser extension exists.

const APP_NAMES: Record<string, string> = {
  "msedge.exe": "Edge",
  "chrome.exe": "Chrome",
  "firefox.exe": "Firefox",
  "telegram.exe": "Telegram",
  "figma.exe": "Figma",
  "afterfx.exe": "After Effects",
  "photoshop.exe": "Photoshop",
  "illustrator.exe": "Illustrator",
  "adobe premiere pro.exe": "Premiere Pro",
  "claude.exe": "Claude",
  "chatgpt.exe": "ChatGPT",
  "cursor.exe": "Cursor",
  "code.exe": "VS Code",
  "deadlock.exe": "Deadlock",
  "discord.exe": "Discord",
  "orca.exe": "Orca",
  "explorer.exe": "Проводник",
  "windowsterminal.exe": "Терминал",
  "obsidian.exe": "Obsidian",
  "notion.exe": "Notion",
  "spotify.exe": "Spotify",
  "steam.exe": "Steam",
  "steamwebhelper.exe": "Steam",
  "lockapp.exe": "Экран блокировки",
  "mpc-hc64.exe": "MPC-HC",
  "vlc.exe": "VLC",
  "blender.exe": "Blender",
  "touchdesigner.exe": "TouchDesigner",
};

export function appName(app: string): string {
  const k = app.toLowerCase();
  return APP_NAMES[k] ?? app.replace(/\.exe$/i, "");
}

const BROWSER = /^(msedge|chrome|firefox|opera|brave|vivaldi|arc)\.exe$/i;
const EDITOR = /^(cursor|code|code - insiders|windsurf)\.exe$/i;
const ADOBE = /^(afterfx|photoshop|illustrator|adobe premiere pro|indesign)\.exe$/i;

// zero-width marks and bidi isolates (Telegram wraps names in them)
const clean = (s: string) => s.replace(/[​-‏⁦-⁩]/g, "").trim();

export function extractContext(app: string, rawTitle: string): string {
  const title = clean(rawTitle);
  if (!title) return "";
  const a = app.toLowerCase();

  if (a === "figma.exe") return title.replace(/\s+[-–]\s+Figma$/, "");

  if (BROWSER.test(app)) {
    return title
      .replace(/\s+and \d+ more pages?/, "")
      .replace(/\s+[-–]\s+(Personal|Работа|Work|Профиль \d+)\s+[-–]\s+Microsoft\s*Edge$/, "")
      .replace(/\s+[-–]\s+(Microsoft\s*Edge|Google Chrome|Mozilla Firefox)$/, "");
  }

  if (EDITOR.test(app)) {
    // "task - folder - Cursor": the folder is the project
    const parts = title.split(/\s+[-–]\s+/);
    return parts.length >= 3 ? parts[parts.length - 2] : parts[0];
  }

  if (ADOBE.test(app)) {
    const m = title.match(/[A-Z]:\\[^*]+?\.(aep|psd|ai|prproj|indd)/i);
    if (m) {
      const p = m[0].split("\\");
      return p.slice(-2).join("\\");
    }
  }

  if (a === "telegram.exe") return title.replace(/^\(\d+\)\s+/, "").replace(/\s+\(\d+\)$/, "");

  return title;
}

const VIDEO = /(YouTube|Twitch|Netflix|Кинопоиск|Kinopoisk|VK Видео|Rutube|Media viewer|Picture[- ]in[- ]picture|Картинка в картинке)/i;

/** A foreground window that plays video keeps you "present" without input. */
export function isVideo(app: string, title: string): boolean {
  return VIDEO.test(title) || /^(vlc|mpc-hc64|potplayermini64|mpv)\.exe$/i.test(app);
}

export const isBrowser = (app: string) => BROWSER.test(app);

/** Apps where Claude Code sessions run: their window title is constant, the session's folder is the project. */
const AGENT_HOSTS = /^(claude|orca|windowsterminal|wezterm-gui|alacritty|powershell|pwsh|cmd|warp|hyper)\.exe$/i;
export const isAgentHost = (app: string) => AGENT_HOSTS.test(app);

/** "C:\Users\me\Desktop\CODE\Tempro" → "Tempro"; scratch workspaces say nothing about a project. */
export function agentFolder(cwd: string): string {
  if (/scratch-workspaces|[\\/]scratch-\d{4}-\d{2}-\d{2}/i.test(cwd)) return "";
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  let last = parts[parts.length - 1] ?? "";
  if (/^(app|apps|src|web|ui|frontend|backend|client|server|packages|src-tauri)$/i.test(last) && parts.length > 1) {
    last = `${parts[parts.length - 2]}/${last}`;
  }
  // the home folder itself isn't a project
  if (parts.length <= 3 && /^users$/i.test(parts[1] ?? "")) return "";
  return last;
}

/** Tab title from the extension, without the site suffix browsers add. */
export function tabContext(title: string, url: string): string {
  const t = clean(title);
  if (t) return t;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
