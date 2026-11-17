import { GET as llms } from '../llms.txt/route';

export const dynamic = 'force-static';

export async function GET() {
  return new Response(await llms().text(), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8', Vary: 'Accept' },
  });
}
