// Program icons from the backend, fetched in batches as icons appear on screen.
import { useSyncExternalStore } from "react";
import { call, hasBackend } from "./api";

const icons = new Map<string, string | null>();
const wanted = new Set<string>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function flush() {
  timer = undefined;
  const apps = [...wanted];
  wanted.clear();
  if (!apps.length) return;
  hasBackend().then((ok) => {
    if (!ok) {
      apps.forEach((a) => icons.set(a, null));
      return;
    }
    call<Record<string, string | null>>("app_icons", { apps })
      .then((r) => {
        for (const a of apps) icons.set(a, r[a] ?? null);
        listeners.forEach((l) => l());
      })
      .catch(() => apps.forEach((a) => icons.set(a, null)));
  });
}

export function useAppIconUrl(app: string): string | null | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      if (!icons.has(app) && !wanted.has(app)) {
        wanted.add(app);
        timer ??= setTimeout(flush, 40);
      }
      return () => listeners.delete(l);
    },
    () => icons.get(app),
  );
}
