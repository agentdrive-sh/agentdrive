import { notFound } from 'next/navigation';
import { SITE_URL } from '@/components/seo/site';
import { frontmatter, markdownResponse, withDirective } from '@/lib/llms';
import { COMPETITORS, compareMarkdown, getCompetitor } from '../../data';

export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return COMPETITORS.map((c) => ({ slug: c.slug }));
}

export async function GET(_req: Request, props: { params: Promise<{ slug: string }> }) {
  const c = getCompetitor((await props.params).slug);
  if (!c) notFound();
  return markdownResponse(
    `${frontmatter({ title: `AgentDrive vs ${c.name}`, description: c.description, canonical: `${SITE_URL}/compare/${c.slug}` })}${withDirective(compareMarkdown(c))}`,
  );
}
