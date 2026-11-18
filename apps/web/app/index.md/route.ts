import { faqMarkdown } from '@/components/marketing/faq';
import { SITE_DESCRIPTION, SITE_TITLE, SITE_URL as SITE } from '@/components/seo/site';
import { frontmatter, markdownResponse } from '@/lib/llms';
import { HOME_FAQ } from '../faq';
import { GET as llms } from '../llms.txt/route';

export const dynamic = 'force-static';

export async function GET() {
  return markdownResponse(
    `${frontmatter({ title: SITE_TITLE, description: SITE_DESCRIPTION, canonical: `${SITE}/` })}${await llms().text()}\n## Questions\n\n${faqMarkdown(HOME_FAQ, '###')}\n`,
  );
}
