// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://indonesia-navi.com',
  i18n: {
    defaultLocale: 'ja',
    locales: ['ja'],
  },
  integrations: [
    sitemap({
      changefreq: 'daily',
      priority: 0.7,
      filter: (page) => !page.includes('/draft'),
    }),
  ],
  markdown: {
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
    },
  },
});
