import { defineCollections, defineDocs, defineConfig } from 'fumadocs-mdx/config';
import { pageSchema } from 'fumadocs-core/source/schema';
import { z } from 'zod';

export const docs = defineDocs({
  dir: 'content/docs',
  docs: { postprocess: { includeProcessedMarkdown: true } },
});

export const blog = defineCollections({
  type: 'doc',
  dir: 'content/blog',
  schema: pageSchema.extend({
    // YAML turns an unquoted 2026-11-02 into a Date; keep it a plain ISO string.
    date: z.preprocess((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v), z.iso.date()),
    author: z.string(),
    draft: z.boolean().default(false),
  }),
});

export default defineConfig();
