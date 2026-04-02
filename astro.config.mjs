// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://indonesia-navi.com',
  i18n: {
    defaultLocale: 'ja',
    locales: ['ja'],
  },
  markdown: {
    shikiConfig: {
      theme: 'github-light',
    },
  },
});
