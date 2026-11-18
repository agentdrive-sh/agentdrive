import { factsMarkdown } from '../facts';

export const dynamic = 'force-static';

export function GET() {
  return new Response(factsMarkdown(), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
}
