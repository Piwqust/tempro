import { RotateCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { call } from "../data/api";
import { useSettings } from "../data/backend";

export type Summary = { headline: string; points: { label: string; text: string }[]; at: number };

const KEY = "ui.ai_summaries";
const DAY = 86_400_000;

/** Written summaries are kept (in the encrypted database), so a day reads the same when you come
 *  back to it. They quote window titles, so they live only as long as titles do (detailDays). */
async function load(): Promise<Record<string, Summary>> {
  try {
    return ((await call<Record<string, Summary> | null>("kv_get", { key: KEY })) ?? {}) as Record<string, Summary>;
  } catch {
    return {};
  }
}

async function save(key: string, s: Summary, keepDays: number) {
  const all = await load();
  all[key] = s;
  if (keepDays > 0) for (const [k, v] of Object.entries(all)) if (s.at - v.at > keepDays * DAY) delete all[k];
  await call("kv_put", { key: KEY, value: all }).catch(() => {});
}

/** One summary card body: ask, show, keep. `key` names what is summarised ("day:2026-10-16"). */
export function AiSummaryBody({ id, payload, empty, onFull }: { id: string; payload: () => Record<string, unknown>; empty: string; onFull?: (full: boolean) => void }) {
  const { settings } = useSettings();
  const [s, setS] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setS(null);
    setErr(null);
    load().then((all) => live && setS(all[id] ?? null));
    return () => void (live = false);
  }, [id]);
  useEffect(() => onFull?.(!!s), [s, onFull]);

  const ask = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await call<Omit<Summary, "at">>("ai_summary", { day: payload() });
      const next = { headline: r.headline, points: r.points ?? [], at: Date.now() };
      setS(next);
      void save(id, next, settings.detailDays ?? 30);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ais">
      <span className="ais-label">
        <Sparkles size={12} /> Сводка от Claude
        {s && (
          <button type="button" className="ais-again" onClick={ask} disabled={busy} title="Написать заново">
            <RotateCw size={12} className={busy ? "spin" : undefined} />
          </button>
        )}
      </span>
      {s ? (
        <>
          {s.headline && <p className="ais-headline">{s.headline}</p>}
          <ul className="ais-points">
            {s.points.map((p, i) => (
              <li key={i}>
                <span className="ais-point-label">{p.label}</span>
                <span className="ais-point-text">{p.text}</span>
              </li>
            ))}
          </ul>
        </>
      ) : err ? (
        <p className="summary-err">{err}</p>
      ) : (
        <p className="ais-empty">{empty}</p>
      )}
      {!s && (
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={ask}>
          {busy ? "Пишу…" : "Написать"}
        </button>
      )}
    </div>
  );
}
