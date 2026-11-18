import { frontmatter, markdownResponse, withDirective } from '@/lib/llms';
import { FACTS_AS_OF, FACTS_DESCRIPTION, factsMarkdown } from '../facts';

export const dynamic = 'force-static';

export function GET() {
  return markdownResponse(
    `${frontmatter({ title: 'AgentDrive facts', description: FACTS_DESCRIPTION, canonical: 'https://agentdrive.sh/facts', 'last-updated': FACTS_AS_OF })}${withDirective(factsMarkdown())}`,
  );
}
