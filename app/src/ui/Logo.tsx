import { WORDMARK } from "./wordmark";

/** The week as a heat map: how full each day was, today in the "now" orange (brand/logo/mark.svg). */
const LEVELS = [
  [0.22, 0.55, 1],
  [0.55, 1, 0.3],
  [1, 0.45, null],
];

export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      {LEVELS.flatMap((row, r) =>
        row.map((op, c) => (
          <rect
            key={`${r}${c}`}
            x={7 + c * 18}
            y={7 + r * 18}
            width="14"
            height="14"
            rx="4"
            fill={op === null ? "var(--signal, #ff5a1f)" : "currentColor"}
            opacity={op ?? undefined}
          />
        )),
      )}
    </svg>
  );
}

/** Mark and wordmark, coloured by the theme. */
export function Logo() {
  const h = 15;
  return (
    <span className="logo" role="img" aria-label="Tempro">
      <Mark size={20} />
      <svg viewBox={`0 0 ${WORDMARK.width} ${WORDMARK.height}`} height={h * (WORDMARK.height / 22)} width={(h * (WORDMARK.height / 22) * WORDMARK.width) / WORDMARK.height} aria-hidden>
        <path transform={`translate(0 ${WORDMARK.baseline})`} d={WORDMARK.d} fill="currentColor" />
      </svg>
    </span>
  );
}
