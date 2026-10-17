// The logo's beat on the shared clock: the orange now-cell breathes every 1.8 s
// (the same rhythm as brand/logo and the README hero). The canvas reads `pulse.v` for today's ring.
import { gsap } from 'gsap';
import { onPage, prefersReducedMotion } from '../engine';

export const pulse = { v: 0 };

export function startPulse() {
  if (prefersReducedMotion()) return;
  let cells: SVGElement[] = [];
  onPage(() => {
    cells = [...document.querySelectorAll<SVGElement>('[data-now]')];
    return () => { cells = []; };
  });
  gsap.ticker.add((t) => {
    pulse.v = (t % 1.8) / 1.8;
    const s = (1 - 0.18 * Math.sin(Math.PI * pulse.v)).toFixed(3);
    for (const c of cells) c.style.scale = s;
  });
}
