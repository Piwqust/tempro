import { invoke, isTauri } from "@tauri-apps/api/core";
import type { RawEvents } from "../engine/types";

/** Every backend call goes through one command (see src-tauri/src/api.rs). In a plain browser
 *  the Vite dev server proxies the same calls to a running debug build of Tempro. */
/** `?demo` in the address: made-up data generated in the page (see demo.ts), for screenshots. */
export const DEMO = !isTauri() && typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");

export async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri()) return invoke<T>("call", { name, args });
  if (DEMO) return (await import("./demo")).demoCall(name, args) as Promise<T>;
  const r = await fetch(`/api/call/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) });
  const text = await r.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(text || `HTTP ${r.status}`);
  }
  if (!r.ok) throw new Error((body as { error?: string })?.error ?? `HTTP ${r.status}`);
  return body as T;
}

let backend: boolean | null = isTauri() || DEMO ? true : null;

/** In the browser, without Tempro running, we can still show ActivityWatch history. */
export async function hasBackend(): Promise<boolean> {
  if (backend !== null) return backend;
  try {
    await call("status");
    backend = true;
  } catch {
    backend = false;
  }
  return backend;
}

export async function fetchRaw(from: number, to: number): Promise<RawEvents> {
  if (await hasBackend()) return call<RawEvents>("events", { from, to });
  const r = await fetch(`/api/aw-events?from=${from}&to=${to}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
