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
    heroImage: z.string().optional(),
    draft: z.boolean().default(false),
    hasAffiliate: z.boolean().default(false),
    affiliatePrograms: z.array(z.string()).default([]),
    mapData: z.array(z.object({
      name: z.string(),
      nameEn: z.string().optional(),
      area: z.string(),
      cuisine: z.enum(['japanese', 'korean', 'chinese', 'indonesian', 'european', 'cafe', 'other']),
      priceRange: z.enum(['budget', 'mid', 'high', 'luxury']),
      googleMapsQuery: z.string(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      isChain: z.boolean().default(false),
      halal: z.enum(['yes', 'no', 'unverified']).default('unverified'),
      servesAlcohol: z.enum(['yes', 'no', 'unverified']).default('unverified'),
    })).optional(),
  }),
});

export const collections = { articles };
