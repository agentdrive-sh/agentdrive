import { readAgentSkill } from '@/lib/agent-skill';

export const dynamic = 'force-static';

export function GET() {
  return new Response(readAgentSkill(), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
}
