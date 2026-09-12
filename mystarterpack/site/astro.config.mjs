import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://mystarterpack.it',
  integrations: [
    sitemap({
      lastmod: new Date(),
      // I link /go/ sono redirect affiliati in noindex: fuori dalla sitemap.
      filter: (page) => !page.includes('/go/'),
    }),
  ],
  // Sito statico; solo /api/subscribe gira on-demand (prerender = false) su Vercel.
  adapter: vercel(),
  trailingSlash: 'never',
  build: { format: 'file' },
});
