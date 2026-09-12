import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://mystarterpack.it',
  integrations: [sitemap()],
  trailingSlash: 'never',
  build: { format: 'file' },
});
