# Tempro for Edge and Chrome

Reports the URL and title of the active tab to Tempro, so browser time is assigned to projects and YouTube without mouse activity counts as "watching" rather than absence.

Install: `edge://extensions` (or `chrome://extensions`) → "Developer mode" → "Load unpacked" → this folder. The extension popup shows whether the app connection is up.

What is sent to Tempro (`http://127.0.0.1:5601/ext/tab`): the URL (Tempro strips query parameters except the YouTube video id), the tab title, the browser, and whether audio/video is playing. Only the active tab of the active window; private windows never.
