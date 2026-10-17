// Dev-only: serves the same data as the Rust `aw_events` command, so the UI can be
// developed in a plain browser against the real ActivityWatch database (read-only).
import type { Plugin } from "vite";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DB = path.join(process.env.LOCALAPPDATA ?? "", "activitywatch", "activitywatch", "aw-server", "peewee-sqlite.v2.db");

const toAw = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace("Z", "000+00:00");
const fromAw = (s: string) => Date.parse(s.replace(" ", "T").replace(/(\.\d{3})\d*/, "$1"));

export function awBridge(): Plugin {
  return {
    name: "tempro-aw-bridge",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/aw-events", (req, res) => {
        try {
          const q = new URL(req.url ?? "", "http://x").searchParams;
          const from = Number(q.get("from"));
          const to = Number(q.get("to"));
          const db = new DatabaseSync(DB, { readOnly: true });
          try {
            const key = (type: string) =>
              (db.prepare("select key from bucketmodel where type = ? order by key limit 1").get(type) as { key: number }).key;
            const stmt = db.prepare(
              "select timestamp, duration, datastr from eventmodel where bucket_id = ? and timestamp >= ? and timestamp < ? order by timestamp",
            );
            const rows = (bucket: number, lookback: number) =>
              (stmt.all(bucket, toAw(from - lookback), toAw(to)) as { timestamp: string; duration: number; datastr: string }[])
                .map((r) => ({ ts: fromAw(r.timestamp), dur: Number(r.duration), data: JSON.parse(r.datastr) }))
                .filter((r) => r.ts + r.dur * 1000 > from);
            const window = rows(key("currentwindow"), 6 * 3_600_000).map((r) => ({
              ts: r.ts, dur: r.dur, app: r.data.app ?? "?", title: r.data.title ?? "",
            }));
            const afk = rows(key("afkstatus"), 48 * 3_600_000).map((r) => ({ ts: r.ts, dur: r.dur, afk: r.data.status === "afk" }));
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ window, afk }));
          } finally {
            db.close();
          }
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e));
        }
      });
    },
  };
}
