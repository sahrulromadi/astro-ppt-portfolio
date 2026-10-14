import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    order: z.number(),
    summary: z.string(),
    stat: z.object({ value: z.string(), label: z.string() }),
    before: z.string(),
    built: z.object({ intro: z.string(), items: z.array(z.string()), note: z.string().optional() }),
    after: z.array(z.string()),
  }),
});

export const collections = { projects };
