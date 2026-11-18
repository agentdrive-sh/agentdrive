import { notFound } from 'next/navigation';
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
  return new Response(`${head.join('\n\n')}\n\n${await post.data.getText('processed')}`, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}
