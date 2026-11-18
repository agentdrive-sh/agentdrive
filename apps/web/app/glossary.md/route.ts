import { plainText } from '@/components/marketing/faq';
import { SITE_URL } from '@/components/seo/site';
import { frontmatter, LLMS_DIRECTIVE, markdownResponse } from '@/lib/llms';
import { GLOSSARY, GLOSSARY_DESCRIPTION } from '../glossary/glossary';

export const dynamic = 'force-static';

export function GET() {
  const terms = GLOSSARY.map((t) => `- [${t.term}](${SITE_URL}/glossary/${t.slug}.md): ${plainText(t.definition)}`);
  return markdownResponse(
    `${frontmatter({ title: 'AgentDrive glossary', description: GLOSSARY_DESCRIPTION, canonical: `${SITE_URL}/glossary` })}# AgentDrive glossary\n\n${LLMS_DIRECTIVE}\n\n> ${GLOSSARY_DESCRIPTION}\n\n${terms.join('\n')}\n`,
  );
}
