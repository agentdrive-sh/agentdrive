import { notFound } from 'next/navigation';
import { source } from '@/lib/source';

export const dynamic = 'force-static';
export const revalidate = false;

export async function GET(_req: Request, props: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await props.params;
  const page = source.getPage(slug);
  if (!page) notFound();
  return new Response(`# ${page.data.title}\n\n${await page.data.getText('processed')}`, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8', Vary: 'Accept' },
  });
}

export function generateStaticParams() {
  return source.generateParams();
}
