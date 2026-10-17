const stateEl = document.getElementById("state");
const portEl = document.getElementById("port");

async function check() {
  const { port = 5601 } = await chrome.storage.local.get("port");
  portEl.value = port;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    const ok = r.ok && (await r.json()).app === "tempro";
    stateEl.textContent = ok ? "подключено" : "не отвечает";
    stateEl.toggleAttribute("data-ok", ok);
  } catch {
    stateEl.textContent = "Tempro не запущен";
    stateEl.removeAttribute("data-ok");
  }
}

portEl.addEventListener("change", async () => {
  const port = Number(portEl.value);
  if (port >= 1024 && port <= 65535) {
    await chrome.storage.local.set({ port });
    check();
  }
});

check();
