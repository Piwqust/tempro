// Tells the background worker whether a YouTube video is playing, so watching without
// touching the mouse counts as "watching", not "away".
(() => {
  let state = null;
  const send = () => {
    const v = document.querySelector("video");
    const now = !!v && !v.paused && !v.ended && v.readyState > 2;
    if (now === state) return;
    state = now;
    try {
      chrome.runtime.sendMessage({ type: "media", playing: now });
    } catch {
      // extension reloaded: this page's script is orphaned, stop quietly
      clearInterval(timer);
    }
  };
  document.addEventListener("play", send, true);
  document.addEventListener("pause", send, true);
  document.addEventListener("ended", send, true);
  const timer = setInterval(send, 5000);
  send();
})();
