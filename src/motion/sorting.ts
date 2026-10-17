// "It sorts itself": raw rows (mono, as recorded) get their project track recorded in from the
// left, one after another. The last row starts unsorted; then the rule appears and it moves to
// Kite Studio, the way a correction re-sorts history in the app.
import { gsap } from 'gsap';
import { onPage, prefersReducedMotion, ease } from '../engine';

export function sorting() {
  onPage(() => {
    const list = document.querySelector<HTMLElement>('[data-sort]');
    if (!list || prefersReducedMotion()) return;
    const rows = [...list.querySelectorAll<HTMLElement>('.sort__row')];
    const fixed = list.querySelector<HTMLElement>('[data-corrected]');
    const rule = document.querySelector<HTMLElement>('[data-rule]');
    list.classList.add('is-armed');
    const tl = gsap.timeline({ scrollTrigger: { trigger: list, start: 'top 88%', once: true } });
    rows.forEach((row, i) => {
      const bar = row.querySelector('.sort__bar');
      const name = row.querySelectorAll('.sort__name, .sort__by');
      const at = i * 0.16;
      if (row === fixed) {
        tl.fromTo(row.querySelector('.sort__none'), { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.7, ease: ease.out }, at);
        return;
      }
      tl.fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: ease.out }, at)
        .fromTo(name, { autoAlpha: 0, x: -8 }, { autoAlpha: 1, x: 0, duration: 0.6, ease: ease.soft, stagger: 0.05 }, at + 0.25);
    });
    if (fixed && rule) {
      const t = rows.length * 0.16 + 0.6;
      tl.fromTo(rule, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: ease.out }, t)
        .to(fixed.querySelector('.sort__none'), { autoAlpha: 0, duration: 0.3 }, t + 0.5)
        .fromTo(fixed.querySelector('.sort__bar'), { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: ease.out }, t + 0.55)
        .fromTo(fixed.querySelectorAll('.sort__name, .sort__by'), { autoAlpha: 0, x: -8 }, { autoAlpha: 1, x: 0, duration: 0.6, ease: ease.soft, stagger: 0.05 }, t + 0.8);
    }
    return () => list.classList.remove('is-armed');
  });
}
