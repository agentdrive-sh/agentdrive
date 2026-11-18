import { notFound } from 'next/navigation';
import { getTerm, GLOSSARY, termMarkdown } from '../../glossary';

export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return GLOSSARY.map((t) => ({ term: t.slug }));
}

export async function GET(_req: Request, props: { params: Promise<{ term: string }> }) {
  const t = getTerm((await props.params).term);
  if (!t) notFound();
  return new Response(termMarkdown(t), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
}
