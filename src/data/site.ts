// Every visible fact on the site lives here.
// Assumptions (owner to confirm):
//   - production URL: https://tempro.angleford.co (GitHub Pages, custom domain)
//   - the hero heat map is demo data generated in the page (src/lib/demo.ts), labelled "demo data"
//   - version shown in the footer: the latest tag in the repo (v0.4.0)

export const site = {
  name: 'Tempro',
  role: 'Automatic time tracking for Windows',
  url: 'https://tempro.angleford.co/',
  description:
    'Tempro records your Windows computer by itself, sorts every window into a project and shows the work of a day, a week or a year. Local and encrypted.',
  repo: 'https://github.com/Piwqust/tempro',
  download: 'https://github.com/Piwqust/tempro/releases/latest',
  docs: 'https://github.com/Piwqust/tempro/blob/main/docs/DEVELOPMENT.md',
  extension: 'https://github.com/Piwqust/tempro/tree/main/extension',
  license: 'https://github.com/Piwqust/tempro/blob/main/LICENSE',
  activitywatch: 'https://activitywatch.net',
  version: '0.4.0',
  platform: 'Windows 10 and 11',
};

/** The zoom chapters of the hero. Key = the app's own shortcut for the period. */
export const periods = [
  { key: 'D', name: 'Day', id: 'day', text: 'One track per project. A video you watch or a call you take is not counted as time away.' },
  { key: 'W', name: 'Week', id: 'week', text: 'Each day as a stack of work, leisure, personal and utility, set against the week before.' },
  { key: 'M', name: 'Month', id: 'month', text: 'Which projects grew this month and which ones quietly faded, by day and by week.' },
  { key: 'Q', name: '3 months', id: 'quarter', text: 'Three months side by side, compared with the three before them.' },
  { key: 'Y', name: 'Year', id: 'year', text: 'A whole year of work on one map, with your busiest hours and weekdays.' },
] as const;

/** Raw window events and what Tempro makes of them (demo titles from the app's demo mode). */
export const sorting = [
  { time: '10:16', app: 'Cursor.exe', title: 'Range.tsx - tempro - Cursor', project: 'Tempro', color: '#16A06A', by: 'editor folder' },
  { time: '11:56', app: 'WindowsTerminal.exe', title: 'cargo test - tempro', project: 'Tempro', color: '#16A06A', by: 'terminal path' },
  { time: '13:31', app: 'Figma.exe', title: 'Aurora website - Figma', project: 'Aurora website', color: '#0E9FA8', by: 'Figma file' },
  { time: '15:02', app: 'msedge.exe', title: 'Aurora staging - Microsoft Edge', project: 'Aurora website', color: '#0E9FA8', by: 'tab address' },
  { time: '17:10', app: 'Telegram.exe', title: 'Kite Studio · design', project: 'Kite Studio', color: '#2F6BFF', by: 'chat name' },
  { time: '18:12', app: 'Figma.exe', title: 'Spring campaign - Figma', project: 'Kite Studio', color: '#2F6BFF', by: 'your rule', corrected: true },
] as const;

export const presence = [
  { k: 'work', name: 'Work', text: 'Keys, clicks and scrolls in this minute.', share: 0.44 },
  { k: 'video', name: 'Video', text: 'Sound is playing and the window is in front.', share: 0.14 },
  { k: 'call', name: 'Call', text: 'The microphone is busy.', share: 0.12 },
  { k: 'pause', name: 'Pause', text: 'A short break, under 15 minutes.', share: 0.1 },
  { k: 'away', name: 'Away', text: 'Nobody at the computer, or it is locked.', share: 0.2 },
] as const;

export const summary = {
  headline: '7.4 h of work, mostly Tempro; evening: games.',
  columns: [
    { label: 'Main', text: '7.4 h of work: Tempro 5.2 h, Kite Studio 1.9 h, Aurora website and design for the rest.' },
    { label: 'Rhythm', text: 'From 10:16 to 23:13. The longest stretch was Tempro, 96 minutes from 10:16. Lunch at 13:36, and a 15 minute gap at 16:27 it asked about.' },
    { label: 'Leisure', text: '2.5 h in the evening: one video, then games.' },
  ],
};

export const privacyFacts = [
  { value: 'AES-256', label: 'The database is encrypted with SQLCipher. Its key lives in Windows Credential Manager, tied to your account.' },
  { value: '30', unit: 'days', label: 'Then window titles and addresses are wiped. Totals stay. You can change the period.' },
  { value: '127.0.0.1', label: 'The only address its server listens on. Nothing leaves your computer unless you turn the AI on.' },
  { value: '0', unit: 'keystrokes', label: 'Keys are counted per minute, never captured. Query strings are stripped, private windows ignored.' },
];

export const install = [
  { title: 'Download the installer', text: 'Tempro_x.y.z_x64-setup.exe from GitHub Releases. It installs for your user, without admin rights.' },
  { title: 'It starts with Windows', text: 'Then it sits in the tray and records. A watchdog brings it back if it ever crashes.' },
  { title: 'Add what you like', text: 'The browser extension for tab addresses and video, and an AI key if you want summaries.' },
];
