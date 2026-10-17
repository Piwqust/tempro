// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Served from the root of its own domain through GitHub Pages (see .github/workflows/pages.yml).
export default defineConfig({
  site: 'https://tempro.angleford.co',
  trailingSlash: 'ignore',
  integrations: [sitemap()],
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  build: { inlineStylesheets: 'auto' },
});
