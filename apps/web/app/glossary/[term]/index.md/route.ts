import { notFound } from 'next/navigation';
import { plainText } from '@/components/marketing/faq';
import { SITE_URL } from '@/components/seo/site';
import { frontmatter, markdownResponse, withDirective } from '@/lib/llms';
import { getTerm, GLOSSARY, termMarkdown } from '../../glossary';

export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return GLOSSARY.map((t) => ({ term: t.slug }));
}

export async function GET(_req: Request, props: { params: Promise<{ term: string }> }) {
  const t = getTerm((await props.params).term);
  if (!t) notFound();
  return markdownResponse(
    `${frontmatter({ title: t.term, description: plainText(t.definition), canonical: `${SITE_URL}/glossary/${t.slug}` })}${withDirective(termMarkdown(t))}`,
  );
}
