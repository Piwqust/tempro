import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { useState } from "react";
import { call } from "../data/api";
import { useBackend } from "../data/backend";
import { appName } from "../engine/context";
import { t } from "../lib/i18n";
import { clock, dayNum, dur, weekday } from "../lib/time";
import { AppIcon } from "../ui/bits";
import { TopBar } from "../ui/TopBar";
import { UnlockForm, useLock } from "../ui/Lock";

type Row = { stream: string; id: number; ts: number; dur: number; a: string; b: string; source: string };

const STREAMS: [string, string][] = [
  ["all", t("Все")],
  ["window", t("Окна")],
  ["afk", t("Присутствие")],
  ["media", t("Звук и микрофон")],
  ["browser", t("Вкладки")],
  ["ocr", t("Текст с экрана")],
];

/** Raw rows as they were written: for checking the tracker against reality. */
export function Journal() {
  const has = useBackend().data;
  const { journalLocked } = useLock();
  const [stream, setStream] = useState("all");
  const q = useQuery({ queryKey: ["journal"], queryFn: () => call<Row[]>("journal", { limit: 400 }), enabled: has === true && !journalLocked, refetchInterval: 4000 });
  const rows = (q.data ?? []).filter((r) => stream === "all" || r.stream === stream);

  return (
    <>
      <TopBar
        icon={<ScrollText size={14} strokeWidth={1.9} />}
        section={t("Журнал")}
        right={
          <div className="segmented">
            {STREAMS.map(([id, l]) => (
              <button key={id} type="button" data-on={stream === id || undefined} onClick={() => setStream(id)}>
                {l}
              </button>
            ))}
          </div>
        }
      />
      <div className="filterbar">
        <span className="summary summary-left">{t("Сырые события, новые сверху. Обновляется каждые 4 секунды.")}</span>
      </div>
      <div className="screen">
        {journalLocked ? (
          <div className="card unlock-card">
            <UnlockForm title={t("Журнал закрыт паролем")} hint={t("Здесь каждое окно и вкладка как есть. Введи пароль, чтобы открыть.")} />
          </div>
        ) : has === false ? (
          <div className="empty">{t("Журнал доступен, когда запущено приложение Tempro")}</div>
        ) : (
          <div className="card journal">
            {rows.map((r) => (
              <div key={`${r.stream}-${r.id}`} className="jrow">
                <span className="jtime">
                  {weekday(r.ts)} {dayNum(r.ts)} · {clock(r.ts)}
                </span>
                <span className={`jstream jstream-${r.stream}`}>{STREAMS.find((s) => s[0] === r.stream)?.[1]}</span>
                {r.stream === "window" || r.stream === "ocr" ? <AppIcon app={r.a} size={16} /> : <span className="jdot" />}
                <span className="jmain truncate">
                  <b>{r.stream === "window" || r.stream === "ocr" ? appName(r.a) : r.a}</b> {r.b}
                </span>
                <span className="jsrc">{r.source}</span>
                <span className="jdur">{r.dur ? dur(r.dur * 1000) : ""}</span>
              </div>
            ))}
            {rows.length === 0 && <div className="empty">{t("Пока пусто")}</div>}
          </div>
        )}
      </div>
    </>
  );
}
