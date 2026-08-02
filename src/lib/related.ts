import type { CollectionEntry } from 'astro:content';
import type { CategorySlug } from './categories';

/**
 * Minimal shape required to score relatedness against a pool of articles.
 * A full CollectionEntry<'articles'> satisfies this structurally, but callers
 * that only have currentId/category/tags on hand (e.g. InternalLinks.astro)
 * can pass a lightweight object literal instead.
 */
export interface RelatedArticleQuery {
  id: string;
  data: {
    category: CategorySlug;
    tags: string[];
  };
}

/**
 * Scores and ranks articles related to `current` out of the `all` pool.
 * Weight: same category +2, each shared tag +1. Ties broken by pubDate descending.
 */
export function getRelatedArticles(
  current: RelatedArticleQuery,
  all: CollectionEntry<'articles'>[],
  limit: number
): CollectionEntry<'articles'>[] {
  return all
    .filter((a) => a.id !== current.id)
    .map((a) => {
      let score = 0;
      if (a.data.category === current.data.category) score += 2;
      for (const tag of a.data.tags) {
        if (current.data.tags.includes(tag)) score += 1;
      }
      return { article: a, score };
    })
    .filter((s) => s.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || b.article.data.pubDate.valueOf() - a.article.data.pubDate.valueOf()
    )
    .slice(0, limit)
    .map((s) => s.article);
}
