import { source } from '@/lib/source';
import { factsMarkdown, ONE_SENTENCE } from '../facts/facts';

export const dynamic = 'force-static';

export async function GET() {
  const docs = await Promise.all(
    source
      .getPages()
      .map(async (p) => `# ${p.data.title}\n\nSource: https://agentdrive.sh${p.url}\n\n${await p.data.getText('processed')}`),
  );
  const body = ['# AgentDrive', `> ${ONE_SENTENCE}`, factsMarkdown(), ...docs].join('\n\n');
  return new Response(`${body}\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
