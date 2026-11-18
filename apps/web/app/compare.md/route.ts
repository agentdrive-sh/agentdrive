import { SITE_URL } from '@/components/seo/site';
import { frontmatter, markdownResponse, withDirective } from '@/lib/llms';
import { COMPARE_LEDE, compareIndexMarkdown } from '../compare/data';

export const dynamic = 'force-static';

export function GET() {
  return markdownResponse(
    `${frontmatter({ title: 'AgentDrive vs the alternatives', description: COMPARE_LEDE, canonical: `${SITE_URL}/compare` })}${withDirective(compareIndexMarkdown())}`,
  );
}
