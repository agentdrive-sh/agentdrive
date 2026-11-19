import { readAgentSkill, skillNames } from '@/lib/agent-skill';

export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return skillNames.map(name => ({ name }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const skill = skillNames.find(candidate => candidate === name);
  if (!skill) return new Response(null, { status: 404 });
  return new Response(readAgentSkill(skill), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
}
