import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const product = z.object({
  name: z.string(),
  brand: z.string().optional().default(''),
  role: z.string(),
  why: z.string(),
  priceRange: z.string(),
  amazonQuery: z.string(),
  asin: z.string().optional().default(''),
  image: z.string().optional().default(''),
  pros: z.array(z.string()).min(1).max(4),
  cons: z.array(z.string()).max(3).optional().default([]),
  tip: z.string().optional().default(''),
});

const packs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/packs' }),
  schema: z.object({
    title: z.string(),
    activity: z.string(),
    category: z.string(),
    emoji: z.string(),
    description: z.string().min(60).max(200),
    level: z.enum(['principiante', 'intermedio']).default('principiante'),
    budgetTotal: z.string(),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    products: z.array(product).length(5),
    video: z.object({
      hook: z.string(),
      script: z.array(z.string()).min(5).max(8),
      status: z.enum(['pending', 'rendered', 'published']).default('pending'),
      instagramUrl: z.string().optional().default(''),
    }),
    faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
  }),
});

export const collections = { packs };
