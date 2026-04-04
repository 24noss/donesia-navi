import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const articles = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/articles' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: z.enum(['safety', 'society', 'business', 'lifestyle', 'travel', 'visa', 'regulation']),
    tags: z.array(z.string()).default([]),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    source: z.string().optional(),
    sourceUrl: z.string().url().optional(),
    draft: z.boolean().default(false),
    hasAffiliate: z.boolean().default(false),
    affiliatePrograms: z.array(z.string()).default([]),
  }),
});

export const collections = { articles };
