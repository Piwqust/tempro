// Reports the focused tab of the focused browser window to Tempro on 127.0.0.1.
// Only the URL without its query string (Tempro strips it again), the title, and whether media plays.

const DEFAULT_PORT = 5601;
const browserName = navigator.userAgent.includes("Edg/") ? "edge" : "chrome";

// YouTube's content script tells us whether the video actually plays (audible lies during muted autoplay)
const playing = new Map();

async function port() {
  try {
    const { port } = await chrome.storage.local.get("port");
    return Number(port) || DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

async function focusedTab() {
  const win = await chrome.windows.getLastFocused({ populate: false }).catch(() => null);
  if (!win || !win.focused || win.incognito) return null;
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  return tab ?? null;
}

let last = "";
let lastAt = 0;

async function report(force = false) {
  const tab = await focusedTab();
  if (!tab || !tab.url || tab.incognito) return;
  const body = {
    url: tab.url,
    title: tab.title ?? "",
    browser: browserName,
    audible: !!tab.audible,
    playing: playing.get(tab.id) ?? false,
    incognito: false,
  };
  const key = JSON.stringify(body);
  // heartbeat every 20 s keeps the row growing; changes go out at once
  if (!force && key === last && Date.now() - lastAt < 20_000) return;
  last = key;
  lastAt = Date.now();
  try {
    const r = await fetch(`http://127.0.0.1:${await port()}/ext/tab`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: key,
    });
    await chrome.storage.local.set({ lastOk: Date.now(), lastError: r.ok ? "" : `HTTP ${r.status}` });
  } catch (e) {
    // Tempro isn't running: nothing to do, try again on the next event
    await chrome.storage.local.set({ lastError: String(e) });
  }
}

chrome.tabs.onActivated.addListener(() => report(true));
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (tab.active && (info.url || info.title || info.audible !== undefined || info.status === "complete")) report(true);
});
chrome.windows.onFocusChanged.addListener(() => report(true));
chrome.tabs.onRemoved.addListener((id) => playing.delete(id));

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "media" && sender.tab?.id != null) {
    playing.set(sender.tab.id, !!msg.playing);
    if (sender.tab.active) report(true);
  }
});

chrome.alarms.create("heartbeat", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "heartbeat") report();
});
// the service worker sleeps; this keeps a beat going while the user is active
chrome.idle.onStateChanged.addListener((s) => s === "active" && report(true));

report(true);
