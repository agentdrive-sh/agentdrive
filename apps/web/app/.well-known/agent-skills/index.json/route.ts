import { readAgentSkill } from '@/lib/agent-skill';

export const dynamic = 'force-static';

export async function GET() {
  const skill = readAgentSkill();
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(skill));
  const hex = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
  return Response.json({
    $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
    skills: [
      {
        name: 'agentdrive',
        type: 'skill-md',
        description: skill.match(/^description:\s*(.+)$/m)?.[1].trim(),
        url: 'https://agentdrive.sh/.well-known/agent-skills/agentdrive/SKILL.md',
        digest: `sha256:${hex}`,
      },
    ],
  });
}
