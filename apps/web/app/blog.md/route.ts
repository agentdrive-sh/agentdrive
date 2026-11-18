import { SITE_URL } from '@/components/seo/site';
import { frontmatter, LLMS_DIRECTIVE, markdownResponse } from '@/lib/llms';
import { BLOG_DESCRIPTION, formatPostDate, listPosts } from '@/lib/source';

export const dynamic = 'force-static';

export function GET() {
  const posts = listPosts().map((p) => `- [${p.data.title}](${SITE_URL}${p.url}.md) (${formatPostDate(p.data.date)})${p.data.description ? `: ${p.data.description}` : ''}`);
  return markdownResponse(
    `${frontmatter({ title: 'AgentDrive blog', description: BLOG_DESCRIPTION, canonical: `${SITE_URL}/blog` })}# AgentDrive blog\n\n${LLMS_DIRECTIVE}\n\n> ${BLOG_DESCRIPTION}\n\nEvery post, newest first. Each link is the markdown version of the post.\n\n${posts.join('\n')}\n`,
  );
}
