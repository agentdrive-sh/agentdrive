import { faqMarkdown } from '@/components/marketing/faq';
import { HOME_FAQ } from '../faq';
import { GET as llms } from '../llms.txt/route';

export const dynamic = 'force-static';

export async function GET() {
  return new Response(`${await llms().text()}\n## Questions\n\n${faqMarkdown(HOME_FAQ, '###')}\n`, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8', Vary: 'Accept' },
  });
}
