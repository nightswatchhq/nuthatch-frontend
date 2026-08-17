import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Documentation lives as Markdown under src/content/docs/<group>/<page>.md. The directory is the
// sidebar group (see DocsLayout); `order` places the page within it. Static, Shiki-highlighted, no
// client runtime - same rules as the rest of the site.
const docs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    order: z.number().default(99),
  }),
});

// Blog posts live as Markdown under src/content/blog. Static build, Shiki-highlighted code, no
// client runtime - same rules as the rest of the site.
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string(),
    author: z.string().default('cargopete'),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

// The nest catalogue. Single source of truth is the org's index repo - the site fetches it at
// build time, so the page and the index can't drift. Build-time only: nothing ships to the client,
// and a failed fetch fails the build loudly (the last good deploy stays live).
const NESTS_INDEX =
  'https://raw.githubusercontent.com/nightswatchhq/nests/main/index.json';
const nests = defineCollection({
  loader: async () => {
    const res = await fetch(NESTS_INDEX);
    if (!res.ok) {
      throw new Error(`nests index fetch failed: ${res.status} ${res.statusText} (${NESTS_INDEX})`);
    }
    const data = (await res.json()) as { nests: Array<{ id: string }> };
    return data.nests; // each entry carries its own `id`
  },
  schema: z.object({
    name: z.string(),
    category: z.string(),
    catalogue_section: z.enum(['graph-protocol', 'subgraph-ports', 'other']).optional(),
    tier: z.number().int().min(0).max(3),
    status: z.enum(['available', 'building', 'planned']),
    chains: z.array(z.string()),
    factory: z.boolean().default(false),
    complexity: z.enum(['trivial', 'low', 'medium', 'high']),
    summary: z.string(),
    events: z.string(),
    command: z.string().optional(),
    repo: z.string().url().optional(),
    note: z.string().optional(),
  }),
});

export const collections = { docs, blog, nests };
