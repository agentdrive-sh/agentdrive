import { ORGANIZATION, SOFTWARE_APPLICATION, techArticle } from '@/components/seo/site';
import { source } from '@/lib/source';

export const dynamic = 'force-static';

export function GET() {
  const context = { '@context': 'https://schema.org' };
  const items = [{ ...context, ...ORGANIZATION }, { ...context, ...SOFTWARE_APPLICATION }, ...source.getPages().map(techArticle)];
  const body = items.map((item) => `${JSON.stringify(item)}\n`).join('');
  return new Response(body, { headers: { 'Content-Type': 'application/x-jsonlines; charset=utf-8' } });
}
