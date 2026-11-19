import { loader } from 'fumadocs-core/source';
import { toFumadocsSource } from 'fumadocs-mdx/runtime/server';
import { blog, docs } from '@/.source/server';

export { formatPostDate } from './date';

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
});

export const blogSource = loader({
  baseUrl: '/blog',
  source: toFumadocsSource(blog, []),
});

export const BLOG_DESCRIPTION =
  'Notes from building AgentDrive: session continuity across Claude Code, Codex, OpenCode, Cursor and Antigravity, provenance, and portable storage.';

export type BlogPost = ReturnType<typeof blogSource.getPages>[number];

const showDrafts = process.env.NODE_ENV !== 'production';

export function getPost(slug: string): BlogPost | undefined {
  const post = blogSource.getPage([slug]);
  return post && (showDrafts || !post.data.draft) ? post : undefined;
}

export function listPosts(): BlogPost[] {
  return blogSource
    .getPages()
    .filter((p) => showDrafts || !p.data.draft)
    .sort((a, b) => b.data.date.localeCompare(a.data.date));
}
