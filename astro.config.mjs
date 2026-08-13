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
      // /tag/: noindexの薄い一覧ページ(タグページ側のコメント参照)。
      // /search/: robots.txtでDisallowしておりsitemap掲載と矛盾するため除外。
      filter: (page) => !page.includes('/draft') && !page.includes('/tag/') && !page.includes('/search'),
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
