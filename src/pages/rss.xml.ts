import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const articles = await getCollection('articles', ({ data }) => !data.draft);
  return rss({
    title: 'DonesiaNavi（ドネシアナビ）',
    description: 'インドネシア在住日本人のための日本語ニュース・生活情報ポータル',
    site: context.site!,
    items: articles
      .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
      .slice(0, 20)
      .map((article) => ({
        title: article.data.title,
        pubDate: article.data.pubDate,
        description: article.data.description,
        link: `/articles/${article.id}/`,
        categories: [article.data.category],
      })),
    customData: '<language>ja</language>',
  });
}
