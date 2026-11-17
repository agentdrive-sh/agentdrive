import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { codexHome } from '@adrive/mcp-server/transcripts/paths';
import { opencodeConfigDir } from './config.js';
import { readTextIfExists, writeFileIfChanged, type WriteAction } from './write-file.js';

// Small instructions block written into each agent host's persistent
// preamble (AGENTS.md, GEMINI.md, cursor rules). Tells the agent when to
// reach for the AgentDrive MCP tools without the user having to ask each
// time. Idempotent: bracketed with markers so re-running adrive init
// updates the same region instead of stacking copies.

const BEGIN = '<!-- agentdrive:auto-context:begin -->';
const END = '<!-- agentdrive:auto-context:end -->';

const INSTRUCTIONS = `${BEGIN}
## AgentDrive — your cross-agent memory

AgentDrive records the user's agent sessions across Claude Code, Codex,
OpenCode, Gemini CLI, Cursor, and Antigravity. Use its MCP tools without waiting to be
asked:

- **Session start** — if the user wants to continue earlier work, call
  \`drive_resume\` (or \`drive_sessions\` to pick a session) and check the
  files it mentions on disk before continuing. For a new task, call
  \`drive_context\` with a short summary of the task.
- **Recall** — for "what did the last session do?" or "show me what Codex
  wrote", call \`drive_sessions\`, \`drive_search\`, or \`drive_recall\`.
- **Saving work** — after producing a file worth sharing with the user's
  other agents, call \`drive_write\`.

Privacy: the user controls capture and encryption with \`adrive privacy\`.
With "Private workspace" on, content is end-to-end encrypted on their
device; the AgentDrive server stores only ciphertext.
${END}`;

interface InstructionsTarget {
  // Harness config dir; the target is skipped when it does not exist.
  root: string;
  path: string;
  format: 'markdown' | 'cursor-mdc';
}

type InstructionsResult = { path: string; action: WriteAction };

export function getInstructionsTargets(
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): InstructionsTarget[] {
  const codex = codexHome(env, home);
  const opencode = opencodeConfigDir(env, home);
  return [
    { root: codex, path: join(codex, 'AGENTS.md'), format: 'markdown' },
    { root: opencode, path: join(opencode, 'AGENTS.md'), format: 'markdown' },
    { root: join(home, '.gemini'), path: join(home, '.gemini', 'GEMINI.md'), format: 'markdown' },
    { root: join(home, '.cursor'), path: join(home, '.cursor', 'rules', 'agentdrive.mdc'), format: 'cursor-mdc' },
  ];
}

function wrap(format: InstructionsTarget['format'], body: string): string {
  if (format === 'cursor-mdc') {
    // Cursor expects MDC frontmatter telling it when to apply the rule.
    return `---\ndescription: AgentDrive — cross-agent memory\nalwaysApply: true\n---\n\n${body}\n`;
  }
  return `\n${body}\n`;
}

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export async function writeInstructions(target: InstructionsTarget): Promise<InstructionsResult> {
  const current = await readTextIfExists(target.path);
  let next: string;
  if (current === null) {
    next = wrap(target.format, INSTRUCTIONS);
  } else if (current.includes(BEGIN) && current.includes(END)) {
    next = current.slice(0, current.indexOf(BEGIN)) + INSTRUCTIONS + current.slice(current.indexOf(END) + END.length);
  } else {
    next = current.trimEnd() + '\n' + wrap(target.format, INSTRUCTIONS);
  }
  return { path: target.path, action: await writeFileIfChanged(target.path, next, { backup: true }) };
}

export async function writeAllInstructions(home: string = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<InstructionsResult[]> {
  const out: InstructionsResult[] = [];
  for (const t of getInstructionsTargets(home, env)) {
    if (await dirExists(t.root)) out.push(await writeInstructions(t));
  }
  return out;
}

export async function removeAllInstructions(
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const targets = getInstructionsTargets(home, env);
  for (const t of targets) {
    try {
      const current = await fs.readFile(t.path, 'utf8');
      if (!current.includes(BEGIN)) continue;
      const beginIdx = current.indexOf(BEGIN);
      const endIdx = current.indexOf(END) + END.length;
      const next = (current.slice(0, beginIdx) + current.slice(endIdx)).trimEnd() + '\n';
      if (next.trim() === '') {
        await fs.unlink(t.path);
      } else {
        await fs.writeFile(t.path, next, 'utf8');
      }
    } catch {
      // ignore
    }
  }
}
