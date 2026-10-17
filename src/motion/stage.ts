// The signature: one canvas camera over the grid of days from the logo. Scroll (or the app's
// own keys D W M Q Y, T) pulls it back from one recorded day to the week, month, 3 months and year.
// Driver: c in 0..4 (the period). Everything in the stage (camera, chapter text, readout, keys)
// is a function of c, so they always agree. Idle: today's cell pulses on the shared clock and the
// now-line advances in real time.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { onPage, prefersReducedMotion, scrollToTarget, isMobile, ease } from '../engine';
import { makeDemo, PROJECTS, addDays, byProject, fmtHours, fmtClock, type Day, type Demo } from '../lib/demo';
import { pulse } from './pulse';

gsap.registerPlugin(ScrollTrigger);

const WEEKS = 53;
const PAST_WEEKS = 41; // today's column: eleven weeks of future stay ahead, faded
const CELL = 0.8; // cell size in grid units, pitch 1 (gap 0.2, like the mark's 14/18)
const H0 = 8 * 60;
const H1 = 24 * 60;

const C = {
  ground: '#ececec',
  surface: '#f7f7f7',
  ink: '#171717',
  muted: '#5c5c5c',
  line: 'rgba(23,23,23,0.13)',
  faint: 'rgba(23,23,23,0.055)',
  grid: 'rgba(23,23,23,0.07)',
  now: '#ff5a1f',
  work: '#1b1b1b',
  video: '#2f6bff',
  call: '#16a06a',
  away: '#bdbdbd',
};

const mix = (a: string, b: string, t: number) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
};
const HEAT = [0.2, 0.42, 0.68, 1].map((t) => mix('#dfe3ec', '#2f6bff', t));
const heatOf = (h: number) => (h <= 0 ? null : HEAT[h < 2 ? 0 : h < 4 ? 1 : h < 6 ? 2 : 3]);

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (f: number) => { const t = clamp((f - 0.14) / 0.72); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const DAY_MS = 86_400_000;
const dayIndex = (a: number, b: number) => Math.round((b - a) / DAY_MS);
const dateLong = (t: number) => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const monthName = (t: number) => new Date(t).toLocaleDateString('en-GB', { month: 'long' });
const monthShort = (t: number) => new Date(t).toLocaleDateString('en-GB', { month: 'short' });

type Rect = { cx: number; cy: number; w: number; h: number };
type Readout = { label: string; value: string; sub: string };

function mondayOf(t: number) {
  const d = new Date(t);
  return addDays(t, -((d.getDay() + 6) % 7));
}

function build(demo: Demo) {
  const start = addDays(mondayOf(demo.today), -PAST_WEEKS * 7);
  const dates: number[] = [];
  for (let i = 0; i < WEEKS * 7; i++) dates.push(addDays(start, i));
  const at = (t: number) => { const i = dayIndex(start, t); return { w: Math.floor(i / 7), d: i % 7 }; };
  const f = at(demo.focus);
  const focusDate = new Date(demo.focus);
  const monthStart = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1).getTime();
  const monthEnd = new Date(focusDate.getFullYear(), focusDate.getMonth() + 1, 0).getTime();
  const qStart = new Date(focusDate.getFullYear(), focusDate.getMonth() - 2, 1).getTime();
  const mA = at(monthStart).w, mB = at(monthEnd).w, qA = Math.max(0, at(qStart).w);
  // stops in (week, weekday) space: x = week, y = weekday
  const stops = [
    { x: f.w, y: f.d, w: CELL, h: CELL, pad: 0.05 },
    { x: f.w, y: 0, w: CELL, h: 6 + CELL, pad: 0.22 },
    { x: mA, y: 0, w: mB - mA + CELL, h: 6 + CELL, pad: 0.3 },
    { x: qA, y: 0, w: f.w - qA + CELL, h: 6 + CELL, pad: 0.45 },
    { x: 0, y: 0, w: WEEKS - 1 + CELL, h: 6 + CELL, pad: 0.6 },
  ];

  // readouts: the same numbers the app would show for this demo person
  const upto = (from: number, to: number) => dates.filter((t) => t >= from && t <= Math.min(to, demo.focus)).map((t) => demo.day(t));
  const sum = (days: (Day | null)[]) => days.reduce((s, d) => s + (d?.work ?? 0), 0);
  const top = (days: (Day | null)[]) => { const b = byProject(days)[0]; return b ? PROJECTS[b[0]].name : 'nothing yet'; };
  const fd = demo.day(demo.focus)!;
  const weekDays = upto(mondayOf(demo.focus), addDays(mondayOf(demo.focus), 6));
  const monthDays = upto(monthStart, monthEnd);
  const qDays = upto(qStart, monthEnd);
  const prevQ = dates.filter((t) => t >= new Date(focusDate.getFullYear(), focusDate.getMonth() - 5, 1).getTime() && t < qStart).map((t) => demo.day(t));
  const all = dates.filter((t) => t <= demo.focus).map((t) => demo.day(t));
  const worked = (days: (Day | null)[]) => days.filter((d) => d && d.work > 0.5).length;
  const readouts: Readout[] = [
    {
      label: `${demo.live ? 'Today' : 'Yesterday'}, ${dateLong(demo.focus)}`,
      value: fmtHours(fd.work),
      sub: `${fmtClock(fd.first)} to ${demo.live ? 'now' : fmtClock(fd.last)}, mostly ${top([fd])}`,
    },
    { label: `Week of ${dateLong(mondayOf(demo.focus))}`, value: fmtHours(sum(weekDays)), sub: `${worked(weekDays)} days worked, most of it on ${top(weekDays)}` },
    { label: monthName(demo.focus), value: fmtHours(sum(monthDays)), sub: `${worked(monthDays)} working days, ${fmtHours(sum(monthDays) / Math.max(1, worked(monthDays)))} h on an average one` },
    { label: `${monthShort(qStart)} to ${monthShort(demo.focus)}`, value: fmtHours(sum(qDays)), sub: `against ${fmtHours(sum(prevQ))} h in the three months before` },
    { label: 'The year so far', value: fmtHours(sum(all)), sub: `${all.filter(Boolean).length} days recorded, ${worked(all)} of them with work` },
  ];
  // which days belong to each period (they stay bright, the rest dims)
  const ranges: [number, number][] = [
    [demo.focus, demo.focus],
    [mondayOf(demo.focus), addDays(mondayOf(demo.focus), 6)],
    [monthStart, monthEnd],
    [qStart, monthEnd],
    [-Infinity, Infinity],
  ];
  // months fully or partly inside the grid, for the bars under the year
  const months: { label: string; w0: number; w1: number; work: number; leisure: number; current: boolean }[] = [];
  for (let i = 0; i < dates.length; i++) {
    const d = new Date(dates[i]);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    let m = months[months.length - 1] as (typeof months)[number] & { key?: string } | undefined;
    if (!m || m.key !== key) {
      m = { label: monthShort(dates[i]), w0: Math.floor(i / 7), w1: Math.floor(i / 7), work: 0, leisure: 0, current: false, key } as (typeof months)[number] & { key: string };
      months.push(m);
    }
    m.w1 = Math.floor(i / 7);
    const day = dates[i] <= demo.today ? demo.day(dates[i]) : null;
    m.work += day?.work ?? 0;
    m.leisure += day?.leisure ?? 0;
    if (dates[i] === demo.today) m.current = true;
  }
  if (months.length && new Date(dates[0]).getDate() !== 1) months.shift(); // a cut first month says nothing
  return { start, dates, at, stops, readouts, ranges, months };
}

export function stage() {
  onPage(({ intro }) => {
    const root = document.querySelector<HTMLElement>('[data-stage]');
    const canvas = root?.querySelector<HTMLCanvasElement>('canvas[data-grid]');
    if (!root || !canvas) return;
    const ctx = canvas.getContext('2d')!;
    const reduced = prefersReducedMotion();
    const demo = makeDemo();
    const g = build(demo);
    const tip = document.getElementById('tip');

    const chapters = [...root.querySelectorAll<HTMLElement>('[data-chapter]')];
    const keys = [...root.querySelectorAll<HTMLButtonElement>('[data-period]')];
    const out = {
      label: root.querySelector<HTMLElement>('[data-readout-label]'),
      value: root.querySelector<HTMLElement>('[data-readout-value]'),
      sub: root.querySelector<HTMLElement>('[data-readout-sub]'),
      period: root.querySelector<HTMLElement>('[data-readout-period]'),
    };

    let W = 0, H = 0, dpr = 1, vertical = false;
    let c = 0; // the driver
    let active = -1;
    const rec = { m: reduced ? H1 : H0 }; // intro: the focus day records in from 08:00
    const recEnd = demo.live ? demo.nowMin : (demo.day(demo.focus)?.last ?? H1);
    let cam = { s: 1, ox: 0, oy: 0 };
    // idle input: the camera leans a little toward the pointer and breathes slowly,
    // so the calendar stays alive while nobody scrolls (zero under reduced motion)
    const idle = { x: 0, y: 0, ax: 0, ay: 0, t: 0 };
    const onAim = (e: PointerEvent) => { idle.ax = e.clientX / innerWidth - 0.5; idle.ay = e.clientY / innerHeight - 0.5; };
    if (!reduced) addEventListener('pointermove', onAim, { passive: true });
    let pointer: { x: number; y: number } | null = null;

    const P = (x: number, y: number) => (vertical ? { x: y, y: x } : { x, y });

    // The open day is not square: it takes the canvas's shape, then closes back into a cell.
    const opening = () => {
      const e = 1 - clamp(c * 1.3);
      const fw = W >= H ? clamp((W / H) * 0.9, 1, 1.8) : 1;
      const fh = W < H ? clamp((H / W) * 0.8, 1, 1.5) : 1;
      return { fw: 1 + (fw - 1) * e, fh: 1 + (fh - 1) * e, fw0: fw, fh0: fh };
    };

    function camera(): Rect & { s: number } {
      const i = Math.min(3, Math.floor(c));
      const t = c >= 4 ? 1 : smooth(c - i);
      const a = g.stops[i], b = g.stops[Math.min(4, i + 1)];
      const o = opening();
      const rect = (s: typeof a) => {
        const p = P(s.x, s.y);
        const sz = vertical ? { w: s.h, h: s.w } : { w: s.w, h: s.h };
        const labelled = s === g.stops[4] || s === g.stops[3]; // room for month labels
        const top = !vertical && labelled ? 0.9 : 0;
        const left = vertical && labelled ? 1.3 : 0;
        const cx = p.x + sz.w / 2, cy = p.y + sz.h / 2;
        if (s === g.stops[0]) { sz.w *= o.fw0; sz.h *= o.fh0; }
        const below = !vertical && s === g.stops[4] ? 14 : 0; // room for the months under the year
        return { cx: cx - left / 2, cy: cy - top / 2 + below / 2, w: sz.w + s.pad * 2 + left, h: sz.h + s.pad * 2 + top + below };
      };
      const A = rect(a), B = rect(b);
      const w = A.w * Math.pow(B.w / A.w, t), h = A.h * Math.pow(B.h / A.h, t);
      const s = Math.min(W / w, H / h);
      return { cx: lerp(A.cx, B.cx, t), cy: lerp(A.cy, B.cy, t), w, h, s };
    }

    function rr(x: number, y: number, w: number, h: number, r: number) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
    }

    function drawDay(day: Day, x: number, y: number, w: number, size: number, k: number, isFocus: boolean) {
      const pad = Math.min(w, size) * 0.075;
      const labels = w > 290 && size > 240;
      const fs = clamp(Math.min(w * 0.022, size * 0.03), 10, 15);
      const narrow = w < 460;
      let labelW = 0;
      if (labels) {
        ctx.font = `500 ${fs}px Inter, sans-serif`;
        const longest = Math.max(ctx.measureText('Presence').width, ...byProject([day]).slice(0, 4).map(([p]) => ctx.measureText(PROJECTS[p].name).width));
        ctx.font = `400 ${fs * 0.92}px Inter, sans-serif`;
        const hoursW = narrow ? 0 : ctx.measureText('00 min').width + fs * 0.8;
        labelW = Math.min(w * (narrow ? 0.42 : 0.36), longest + fs * 1.3 + hoursW + fs * 2);
      }
      const x0 = x + pad + labelW, x1 = x + w - pad;
      const X = (m: number) => x0 + ((clamp(m, H0, H1) - H0) / (H1 - H0)) * (x1 - x0);
      const work = byProject([day]).slice(0, 4);
      const leisure = day.blocks.filter((b) => PROJECTS[b.p].kind === 'leisure');
      const rows = work.length + (leisure.length ? 1 : 0) + 1;
      const rulerH = size > 200 ? Math.max(fs * 2, size * 0.08) : 0;
      const rowH = (size - pad * 2 - rulerH) / rows;
      const limit = isFocus ? rec.m : H1;
      ctx.save();
      ctx.globalAlpha *= k;
      // ruler
      if (rulerH) {
        const step = x1 - x0 > 520 ? 120 : 240;
        ctx.font = `400 ${fs * 0.86}px Inter, sans-serif`;
        ctx.textBaseline = 'middle';
        for (let m = H0; m <= H1; m += step) {
          const gx = X(m);
          ctx.fillStyle = C.grid;
          ctx.fillRect(Math.round(gx), y + pad + rulerH * 0.75, 1, size - pad * 2 - rulerH * 0.75);
          if (labels && m < H1) { ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.fillText(fmtClock(m), gx, y + pad + rulerH * 0.35); }
        }
      }
      const rowY = (i: number) => y + pad + rulerH + rowH * i;
      // clip the tracks to what has been recorded so far (the intro and the live edge)
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, X(Math.min(limit, H1)) - x, size);
      ctx.clip();
      const bar = (s: number, e: number, cy: number, bh: number, color: string) => {
        const bx = X(s), bw = Math.max(1.5, X(e) - bx - Math.max(0.5, w * 0.0015));
        ctx.fillStyle = color;
        rr(bx, cy - bh / 2, bw, bh, Math.min(4, bh * 0.3));
        ctx.fill();
      };
      const bh = Math.max(3, rowH * 0.34);
      work.forEach(([p], i) => {
        const cy = rowY(i) + rowH / 2;
        for (const b of day.blocks) if (b.p === p) bar(b.s, b.e, cy, bh, PROJECTS[p].color);
      });
      if (leisure.length) {
        const cy = rowY(work.length) + rowH / 2;
        for (const b of leisure) bar(b.s, b.e, cy, bh, PROJECTS[b.p].color);
      }
      // presence: work solid, video blue, call green, pause dots, away dashed
      const py = rowY(rows - 1) + rowH / 2;
      const ph = Math.max(2, rowH * 0.2);
      for (const s of day.presence) {
        if (s.k === 'work' || s.k === 'video' || s.k === 'call') bar(s.s, s.e, py, ph, C[s.k]);
        else {
          ctx.fillStyle = s.k === 'pause' ? C.muted : C.away;
          const dot = Math.max(1.5, ph * (s.k === 'pause' ? 0.5 : 0.9));
          const gap = dot * (s.k === 'pause' ? 2.2 : 1.8);
          for (let gx = X(s.s) + gap * 0.3; gx < X(s.e) - dot; gx += gap) ctx.fillRect(gx, py - (s.k === 'pause' ? dot / 2 : ph / 2), dot, s.k === 'pause' ? dot : ph);
        }
      }
      ctx.restore();
      // labels column
      if (labels) {
        ctx.textBaseline = 'middle';
        const lx = x + pad;
        const names = [...work.map(([p, m]) => ({ name: PROJECTS[p].name, color: PROJECTS[p].color, h: m / 60 })),
          ...(leisure.length ? [{ name: 'Leisure', color: null as string | null, h: day.leisure }] : []),
          { name: 'Presence', color: null, h: -1 }];
        names.forEach((n, i) => {
          const cy = rowY(i) + rowH / 2;
          ctx.textAlign = 'left';
          const sy = narrow && n.h >= 0 ? cy - fs * 0.55 : cy;
          if (n.color) { ctx.fillStyle = n.color; rr(lx, sy - fs * 0.4, fs * 0.8, fs * 0.8, fs * 0.22); ctx.fill(); }
          ctx.fillStyle = n.h < 0 ? C.muted : C.ink;
          ctx.font = `${n.h < 0 ? 400 : 500} ${fs}px Inter, sans-serif`;
          const nx = lx + (n.color ? fs * 1.3 : 0);
          let hours = '';
          if (n.h >= 0) {
            const shown = isFocus ? Math.min(n.h, n.h * clamp((rec.m - H0) / Math.max(1, recEnd - H0))) : n.h;
            hours = shown >= 1 ? `${fmtHours(shown)} h` : `${Math.round(shown * 60)} min`;
            ctx.fillStyle = C.muted;
            ctx.font = `400 ${fs * 0.92}px Inter, sans-serif`;
            if (narrow) { ctx.textAlign = 'left'; ctx.fillText(hours, nx, cy + fs * 0.7); }
            else { ctx.textAlign = 'right'; ctx.fillText(hours, x0 - fs * 1.2, cy); }
          }
          const hoursW = hours && !narrow ? ctx.measureText('00 min').width + fs * 0.8 : 0;
          ctx.fillStyle = n.h < 0 ? C.muted : C.ink;
          ctx.font = `${n.h < 0 ? 400 : 500} ${fs}px Inter, sans-serif`;
          ctx.textAlign = 'left';
          const maxW = x0 - fs * 1.2 - hoursW - nx;
          let name = n.name;
          if (ctx.measureText(name).width > maxW) {
            while (name.length > 2 && ctx.measureText(name + '…').width > maxW) name = name.slice(0, -1);
            name = name.trimEnd() + '…';
          }
          ctx.fillText(name, nx, narrow && hours ? cy - fs * 0.55 : cy);
        });
      }
      // the now-line rides the recording edge (intro) or stands at the current minute (live)
      const edge = isFocus && (rec.m < recEnd - 0.5 || day.partial) ? Math.min(rec.m, recEnd) : -1;
      if (edge > H0) {
        const nx = X(edge);
        const top = y + pad + (rulerH ? rulerH * 0.62 : 0);
        ctx.fillStyle = C.now;
        ctx.fillRect(nx - 1, top, 2, y + size - pad - top);
        const hs = clamp(Math.min(w, size) * 0.02, 5, 10);
        rr(nx - hs / 2, top - hs / 2, hs, hs, hs * 0.28);
        ctx.fill();
      }
      ctx.restore();
    }

    function draw() {
      if (!W) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const k = camera();
      const breath = reduced ? 0 : Math.sin(idle.t * 0.9);
      const s = k.s * (1 + 0.006 * breath);
      const ox = W / 2 - k.cx * s - idle.x * 22, oy = H / 2 - k.cy * s - idle.y * 14 + breath * 2;
      cam = { s, ox, oy };
      const px = CELL * s;
      const r = Math.min(px * 0.28, 18);
      const detail = clamp((px - 120) / 170);
      const phase = pulse.v;
      const ci = Math.min(3, Math.floor(c));
      const ct = c >= 4 ? 1 : smooth(c - ci);
      const inR = (t: number, j: number) => (t >= g.ranges[j][0] && t <= g.ranges[j][1] ? 1 : 0);
      const o = opening();
      const order: number[] = [];
      for (let i = 0; i < g.dates.length; i++) if (g.dates[i] !== demo.focus) order.push(i);
      order.push(g.dates.indexOf(demo.focus)); // the open day sits on top of its neighbours
      for (const i of order) {
        const t = g.dates[i];
        const p = P(Math.floor(i / 7), i % 7);
        const isFocus = t === demo.focus;
        const isToday = t === demo.today;
        let x = ox + p.x * s, y = oy + p.y * s, cw = px, ch = px;
        if (isFocus) { cw = px * o.fw; ch = px * o.fh; x -= (cw - px) / 2; y -= (ch - px) / 2; }
        if (x > W || y > H || x + cw < 0 || y + ch < 0) continue;
        const inside = lerp(inR(t, ci), inR(t, Math.min(4, ci + 1)), ct);
        const alpha = lerp(lerp(0, 0.16, clamp(c * 2.5)), 1, inside);
        ctx.globalAlpha = alpha;
        if (t > demo.today) {
          ctx.strokeStyle = C.line;
          ctx.lineWidth = 1;
          rr(x + 0.5, y + 0.5, cw - 1, ch - 1, r);
          ctx.stroke();
          continue;
        }
        const day = demo.day(t);
        ctx.fillStyle = (day && heatOf(day.work)) || (day ? C.faint : 'rgba(23,23,23,0.035)');
        rr(x, y, cw, ch, r);
        ctx.fill();
        if (detail > 0 && day) {
          ctx.globalAlpha = alpha * detail;
          ctx.fillStyle = C.surface;
          rr(x, y, cw, ch, r);
          ctx.fill();
          if (isFocus && o.fw * o.fh > 1.02) { ctx.strokeStyle = C.line; ctx.lineWidth = 1; rr(x + 0.5, y + 0.5, cw - 1, ch - 1, r); ctx.stroke(); }
          ctx.globalAlpha = alpha;
          drawDay(day, x, y, cw, ch, detail, isFocus);
        }
        if (isToday) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = C.now;
          ctx.lineWidth = clamp(px * 0.06, 1.5, 3);
          rr(x, y, cw, ch, r);
          ctx.stroke();
          if (!reduced) { // the logo's beat: a ring that leaves the cell and fades
            const grow = phase * clamp(px * 0.5, 9, 28);
            ctx.globalAlpha = 0.7 * (1 - phase);
            ctx.lineWidth = 2;
            rr(x - grow, y - grow, cw + grow * 2, ch + grow * 2, r + grow);
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
      // month and weekday labels once cells are small enough to need them
      const lab = clamp((60 - px) / 30);
      if (lab > 0) {
        ctx.globalAlpha = lab;
        ctx.fillStyle = C.muted;
        ctx.font = `400 ${clamp(px * 0.62, 10, 13)}px Inter, sans-serif`;
        ctx.textBaseline = 'alphabetic';
        let last = -1;
        for (let w = 0; w < WEEKS; w++) {
          const m = new Date(g.dates[w * 7]).getMonth();
          if (m === last) continue;
          if (last !== -1 || new Date(g.dates[w * 7]).getDate() <= 7) {
            const p = P(w, 0);
            const t = monthShort(g.dates[w * 7 + 6] ?? g.dates[w * 7]);
            if (vertical) { ctx.textAlign = 'right'; const lx = ox + p.x * s - px * 0.35; if (lx - ctx.measureText(t).width > 2) ctx.fillText(t, lx, oy + p.y * s + px * 0.8); }
            else { ctx.textAlign = 'left'; ctx.fillText(t, ox + p.x * s, oy + p.y * s - px * 0.45); }
          }
          last = m;
        }
      }
      ctx.globalAlpha = 1;
      if (!vertical) drawMonths(ox, oy, s, px);
    }

    // By month, work and leisure, under the year (horizontal layout only, fades in near Y)
    function drawMonths(ox: number, oy: number, s: number, px: number) {
      const a = clamp((c - 3.15) / 0.4);
      if (a <= 0) return;
      const top = oy + (6 + CELL) * s + Math.max(28, px * 2.2);
      const bottom = H - 6;
      if (bottom - top < 70) return;
      const fs = 12;
      const barTop = top + fs * 3.6, barBottom = bottom - fs * 1.9;
      const maxH = barBottom - barTop;
      let peak = 1;
      for (const m of g.months) peak = Math.max(peak, m.work + m.leisure);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `500 ${fs}px Inter, sans-serif`;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.fillStyle = C.ink;
      const lx = Math.max(ox, W * 0.04);
      ctx.fillText('By month', lx, top + fs);
      const lw = ctx.measureText('By month').width;
      ctx.fillStyle = C.muted;
      ctx.font = `400 ${fs}px Inter, sans-serif`;
      ctx.fillText('work and leisure, hours', lx + lw + fs * 0.8, top + fs);
      for (const m of g.months) {
        // centred on the month's own days, about three and a half columns wide, so neighbours never touch
        const mid = ox + ((m.w0 + m.w1) / 2 + CELL / 2) * s;
        const w = Math.min(3.4, m.w1 - m.w0 + CELL) * s;
        const x0 = mid - w / 2;
        if (x0 < W * 0.02 || x0 + w > W * 0.99) continue; // half-visible months under the faded edges say nothing
        if (w < 6) continue;
        const total = m.work + m.leisure;
        const h = (total / peak) * maxH * a;
        const hw = (m.work / peak) * maxH * a;
        if (total > 0) { ctx.fillStyle = C.faint; rr(x0, barTop, w, maxH, Math.min(6, w * 0.15)); ctx.fill(); }
        else { ctx.strokeStyle = C.line; ctx.lineWidth = 1; rr(x0 + 0.5, barBottom - 12, w - 1, 11.5, 4); ctx.stroke(); }
        if (total > 0) {
          ctx.save();
          rr(x0, barBottom - h, w, h, Math.min(6, w * 0.15));
          ctx.clip();
          ctx.fillStyle = '#E5408A';
          ctx.fillRect(x0, barBottom - h, w, h - hw);
          ctx.fillStyle = C.video;
          ctx.fillRect(x0, barBottom - hw, w, hw);
          ctx.restore();
          ctx.fillStyle = C.ink;
          ctx.textAlign = 'center';
          ctx.font = `500 ${fs}px Inter, sans-serif`;
          ctx.fillText(`${Math.round(total)} h`, x0 + w / 2, barBottom - h - 6);
        }
        ctx.fillStyle = m.current ? C.ink : C.muted;
        ctx.textAlign = 'center';
        ctx.font = `${m.current ? 600 : 400} ${fs}px Inter, sans-serif`;
        ctx.fillText(m.label, x0 + w / 2, bottom - 2);
      }
      ctx.restore();
    }

    function setChapter(i: number) {
      if (i === active) return;
      const prev = active;
      active = i;
      const r = g.readouts[i];
      if (out.label) out.label.textContent = r.label;
      if (out.value) out.value.textContent = r.value;
      if (out.sub) out.sub.textContent = r.sub;
      if (out.period) out.period.textContent = chapters[i]?.dataset.name ?? '';
      keys.forEach((k, j) => k.setAttribute('aria-pressed', String(j === i)));
      root!.dataset.active = String(i);
      root!.classList.toggle('is-past-intro', i > 0);
      if (reduced || !root!.classList.contains('is-staged')) return;
      const show = chapters[i], hide = chapters[prev];
      if (hide) gsap.to(hide, { autoAlpha: 0, y: -14, duration: 0.45, ease: ease.soft, overwrite: true });
      if (show) gsap.fromTo(show, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: ease.out, delay: prev === -1 ? 0 : 0.12, overwrite: true });
      gsap.fromTo([out.value, out.sub, out.label], { yPercent: 40, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.6, ease: ease.out, stagger: 0.04, overwrite: true });
    }

    // canvas size
    const ro = new ResizeObserver(() => {
      const b = canvas.getBoundingClientRect();
      W = b.width; H = b.height;
      dpr = Math.min(isMobile() ? 1.5 : 2, devicePixelRatio || 1); // phones: fewer pixels per frame, still crisp
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      vertical = isMobile();
      draw();
    });
    ro.observe(canvas);
    document.fonts.ready.then(draw);

    // the driver: scroll progress through the stage, holds at the start, steps through 5 periods
    const staged = !reduced;
    root.classList.toggle('is-staged', staged);
    let st: ScrollTrigger | null = null;
    const toC = (p: number) => clamp((p - 0.03) / 0.9) * 4;
    if (staged) {
      chapters.forEach((ch, j) => gsap.set(ch, { autoAlpha: j === 0 ? 1 : 0 }));
      st = ScrollTrigger.create({
        trigger: root,
        start: 'top top',
        end: 'bottom bottom',
        invalidateOnRefresh: true,
        onUpdate: (self) => { c = toC(self.progress); const i = Math.min(3, Math.floor(c)); setChapter(c >= 4 ? 4 : smooth(c - i) < 0.5 ? i : i + 1); },
      });
    }
    setChapter(0);

    // one clock: redraw on the ticker only while the stage is on screen
    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(root);
    const tick = (time: number) => {
      if (!visible) return;
      if (!reduced) {
        const r = 1 - Math.pow(0.95, gsap.ticker.deltaRatio());
        idle.t = time; idle.x += (idle.ax - idle.x) * r; idle.y += (idle.ay - idle.y) * r;
      }
      if (demo.live) { const d = new Date(); demo.nowMin = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; }
      draw();
      if (pointer) showTip();
    };
    gsap.ticker.add(tick);

    // intro: the focus day records in, left to right, up to its last minute or to now
    if (!reduced) {
      intro.add(gsap.to(rec, { m: recEnd, duration: 1.7, ease: 'power2.inOut', onUpdate: draw }), 0.25);
      if (demo.live) intro.add(() => { rec.m = H1; }, '>');
    } else rec.m = H1;

    // period keys: buttons and the app's physical keys (any layout)
    if (!reduced) {
      const full = g.readouts[0].value;
      const total = demo.day(demo.focus)?.work ?? 0;
      intro.add(gsap.fromTo({ v: 0 }, { v: 0 }, {
        v: 1, duration: 1.7, ease: 'power2.inOut',
        onUpdate() { if (active === 0 && out.value) out.value.textContent = fmtHours(total * (this.targets()[0] as { v: number }).v); },
        onComplete() { if (active === 0 && out.value) out.value.textContent = full; },
      }), 0.25);
    }

    const go = (i: number) => {
      if (st && staged) {
        const p = 0.03 + (i / 4) * 0.9;
        scrollToTarget(st.start + p * (st.end - st.start) + 1);
      } else {
        c = i; setChapter(i); draw();
      }
    };
    keys.forEach((k, j) => k.addEventListener('click', () => go(j)));
    const codes: Record<string, number> = { KeyD: 0, KeyT: 0, KeyW: 1, KeyM: 2, KeyQ: 3, KeyY: 4 };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const i = codes[e.code];
      if (i === undefined) return;
      e.preventDefault();
      go(i);
    };
    addEventListener('keydown', onKey);

    // hover card, like the app's: a block when the day is open, otherwise the day
    function showTip() {
      if (!tip || !pointer) return;
      const b = canvas!.getBoundingClientRect();
      const mx = pointer.x - b.left, my = pointer.y - b.top;
      const gx = (mx - cam.ox) / cam.s, gy = (my - cam.oy) / cam.s;
      const gp = P(Math.floor(gx), Math.floor(gy));
      const fx = gx - Math.floor(gx), fy = gy - Math.floor(gy);
      const idx = gp.x * 7 + gp.y;
      let html = '';
      if (gp.x >= 0 && gp.x < WEEKS && gp.y >= 0 && gp.y < 7 && fx < CELL && fy < CELL) {
        const t = g.dates[idx];
        const day = demo.day(t);
        if (t > demo.today) html = `<b>${dateLong(t)}</b><span>Not yet</span>`;
        else if (!day) html = `<b>${dateLong(t)}</b><span>Before Tempro was installed</span>`;
        else html = `<b>${dateLong(t)}${t === demo.today ? ', today' : ''}</b><span>${day.work ? `${fmtHours(day.work)} h of work` : 'No work'}${day.leisure ? `, ${fmtHours(day.leisure)} h leisure` : ''}</span>`;
      }
      if (!html) { tip.classList.remove('is-on'); return; }
      if (tip.innerHTML !== html) tip.innerHTML = html;
      tip.style.translate = `${Math.min(pointer.x + 16, innerWidth - tip.offsetWidth - 8)}px ${pointer.y + 18}px`;
      tip.classList.add('is-on');
    }
    const onMove = (e: PointerEvent) => { if (e.pointerType === 'mouse') { pointer = { x: e.clientX, y: e.clientY }; showTip(); } };
    const onLeave = () => { pointer = null; tip?.classList.remove('is-on'); };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);

    return () => {
      gsap.ticker.remove(tick);
      ro.disconnect();
      io.disconnect();
      removeEventListener('keydown', onKey);
      removeEventListener('pointermove', onAim);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      onLeave();
    };
  });
}

