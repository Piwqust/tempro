# tempro.angleford.co

The landing page for [Tempro](https://github.com/Piwqust/tempro), automatic time tracking for Windows.
This branch holds only the site; the app lives on `main`.

- Stack: Astro (static), GSAP, Lenis. The hero heat map is a canvas fed by demo data generated in the browser (`src/lib/demo.ts`).
- Copy and facts: `src/data/site.ts`. Design notes: `DESIGN.md`.
- Run: `npm install`, then `npm run dev`. Build: `npm run build` (output in `dist/`).
- Deploy: every push to this branch builds and publishes to GitHub Pages (`.github/workflows/pages.yml`).
