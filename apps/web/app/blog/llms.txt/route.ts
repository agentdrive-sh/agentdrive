import { link } from '@/lib/llms';
import { BLOG_DESCRIPTION, listPosts } from '@/lib/source';

export const dynamic = 'force-static';

export function GET() {
  const body = [
    '# AgentDrive blog',
    '',
    `> ${BLOG_DESCRIPTION} Each link is the markdown version of the post.`,
    '',
    '## Posts',
    '',
    ...listPosts().map((p) => link(p.data.title, `${p.url}.md`, p.data.description)),
    '',
    '## Optional',
    '',
    link('Blog index', '/blog.md'),
    link('Site-wide index', '/llms.txt'),
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
