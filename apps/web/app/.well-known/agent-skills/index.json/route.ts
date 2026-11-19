import { createHash } from 'node:crypto';
import { readAgentSkill, skillNames } from '@/lib/agent-skill';

export const dynamic = 'force-static';

export function GET() {
  return Response.json({
    $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
    skills: skillNames.map(name => {
      const skill = readAgentSkill(name);
      return {
        name,
        type: 'skill-md',
        description: skill.match(/^description:\s*(.+)$/m)?.[1].trim(),
        url: `https://agentdrive.sh/.well-known/agent-skills/${name}/SKILL.md`,
        digest: `sha256:${createHash('sha256').update(skill).digest('hex')}`,
      };
    }),
  });
}
