import { notFound } from 'next/navigation';
import { frontmatter, markdownResponse } from '@/lib/llms';
import { formatPostDate, getPost, listPosts } from '@/lib/source';

export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return listPosts().map((post) => ({ slug: post.slugs[0] }));
}

export async function GET(_req: Request, props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const post = getPost(slug);
  if (!post) notFound();
  const head = [
    `# ${post.data.title}`,
    ...(post.data.description ? [`> ${post.data.description}`] : []),
    `By ${post.data.author}, ${formatPostDate(post.data.date)}. Source: https://agentdrive.sh${post.url}`,
  ];
  const meta = frontmatter({
    title: post.data.title,
    description: post.data.description,
    canonical: `https://agentdrive.sh${post.url}`,
    'last-updated': post.data.updated ?? post.data.date,
  });
  return markdownResponse(`${meta}${head.join('\n\n')}\n\n${await post.data.getText('processed')}`);
}
