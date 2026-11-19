import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Only these build-time inputs are served by the public routes.
export const skillNames = ['agentdrive', 'agentdrive-session-handoff', 'agentdrive-artifact-search'] as const;

export function readAgentSkill(name: typeof skillNames[number]): string {
  return readFileSync(join(process.cwd(), '../../plugins/agentdrive/skills', name, 'SKILL.md'), 'utf8');
}
