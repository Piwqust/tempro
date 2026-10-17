// Global motion for this site: runs once on the client, before the first page initializes.
import { gsap } from 'gsap';
import { setTransition, ease, onScroll } from '../engine';
import { stage } from './stage';
import { sorting } from './sorting';
import { startPulse } from './pulse';

export function setupMotion() {
  // Page transition: the seven days of a week record in from the left, the orange edge leading,
  // then record out to the right on the new page.
  setTransition({
    leave: (c) => gsap.timeline()
      .set(c, { autoAlpha: 1 })
      // tracks start at different times, like sessions in a day
      .fromTo(c.querySelectorAll('.curtain__band'), { scaleX: 0, transformOrigin: '0% 50%' },
        { scaleX: 1.02, duration: 0.7, ease: ease.inOut, stagger: (i) => [0, 0.12, 0.05, 0.18, 0.08, 0.15, 0.02][i] ?? 0 }),
    enter: (c) => gsap.timeline()
      .set(c.querySelectorAll('.curtain__band'), { transformOrigin: '100% 50%' })
      .to(c.querySelectorAll('.curtain__band'), { scaleX: 0, duration: 0.75, ease: ease.inOut, stagger: (i) => [0.1, 0, 0.16, 0.04, 0.12, 0.02, 0.08][i] ?? 0 })
      .set(c, { autoAlpha: 0 }),
  });

  // The header steps aside while reading down and returns on the way up.
  let last = 0;
  onScroll(({ y }) => {
    if (Math.abs(y - last) < 6) return;
    document.documentElement.classList.toggle('frame-away', y > 240 && y > last);
    document.documentElement.classList.toggle('is-scrolled', y > 8);
    last = y;
  });

  startPulse();
  stage();
  sorting();
}
