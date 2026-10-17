import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { t } from "../lib/i18n";
import { durParts, HOUR } from "../lib/time";

export function Num({ ms }: { ms: number }) {
  const [n, u] = durParts(ms);
  return (
    <span className="ov-num">
      {n}
      <small>{u}</small>
    </span>
  );
}

/** "+12 % к прошлому месяцу"; nothing when there is nothing to compare with. */
export function Delta({ now, before, than, invert = false }: { now: number; before: number; than: string; invert?: boolean }) {
  if (before < HOUR) return null;
  const pct = Math.round(((now - before) / before) * 100);
  if (Math.abs(pct) < 3) return <span className="mon-delta">{t("±0% {than}", { than })}</span>;
  const up = pct > 0;
  const good = invert ? !up : up;
  return (
    <span className="mon-delta" data-tone={good ? "good" : "bad"}>
      {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {up ? "+" : "−"}
      {t("{pct}% {than}", { pct: Math.abs(pct), than })}
    </span>
  );
}
