import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Both callers are force-static and prerendered at build, so the Worker runtime never reads fs.
export function readAgentSkill(): string {
  return readFileSync(join(process.cwd(), '../../plugins/agentdrive/skills/agentdrive/SKILL.md'), 'utf8');
}
