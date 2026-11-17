export type CommandHarness = 'claude-code' | 'codex' | 'opencode' | 'gemini-cli' | 'cursor' | 'antigravity';
export type CommandName = 'resume' | 'sessions' | 'login';

interface CommandTemplate {
  description: string;
  argumentHint?: string;
  body: string;
}

const ARGS = '{{ARGS}}';

const TEMPLATES: Record<CommandName, CommandTemplate> = {
  resume: {
    description: 'Resume an AgentDrive session from any agent harness',
    argumentHint: '[session-id]',
    body: `Resume earlier agent work from AgentDrive.

1. Call the \`drive_resume\` MCP tool. If a session id was given (${ARGS}), pass it as \`session_id\`; otherwise call it with no arguments to get the most recent session for this project.
2. Summarize the handoff for the user in 3-5 bullets: the goal, what is done, what is left, and any open questions.
3. Before relying on the handoff, check the current state on disk of the files it mentions; the work may have changed since that session ended.
4. Continue the work from where it stopped.

If the \`drive_resume\` tool is not available, run \`adrive resume\` in the shell (add the session id if one was given) and use its output as the handoff.
`,
  },
  sessions: {
    description: 'List recent AgentDrive sessions across agent harnesses',
    argumentHint: '[platform or project]',
    body: `List recent agent sessions captured by AgentDrive.

Call the \`drive_sessions\` MCP tool. If a filter was given (${ARGS}), pass a harness name (claude-code, codex, opencode, gemini-cli, cursor, antigravity) as \`platform\` and anything else as \`project\`.

Show the result as a compact list: session id, harness, project, when it was last active, and a one-line summary. Then tell the user they can pick one up with the AgentDrive resume command and its session id.

If the \`drive_sessions\` tool is not available, run \`adrive resume --list\` in the shell instead.
`,
  },
  login: {
    description: 'Log in to AgentDrive and connect your other agent harnesses',
    body: `Log the user in to AgentDrive and connect their other agent tools.

1. Run \`npx -y @adrive/cli init --yes\` in the shell, in the background so you can read its output while it waits. It prints a sign-in URL and a code and opens the browser. Show the user both right away: they type the code on that page to finish signing in. Init then connects every installed agent tool: Codex, OpenCode, Gemini CLI, Cursor, Antigravity and MCP clients.
2. When it exits, relay init's summary to the user, including any manual step it lists.
`,
  },
};

// Login is plugin-only: init itself is what wires the other harnesses, so it
// has already logged in by the time their commands exist.
export const HARNESS_COMMANDS: CommandName[] = ['resume', 'sessions'];

// Codex prompts, OpenCode, and Cursor commands share a flat namespace with
// built-ins such as /resume and /sessions, so they get a prefix. Antigravity
// has no command files, only skills.
export function commandFileName(harness: CommandHarness, name: CommandName): string {
  if (harness === 'gemini-cli') return `${name}.toml`;
  if (harness === 'antigravity') return `agentdrive-${name}/SKILL.md`;
  if (harness === 'claude-code') return `${name}.md`;
  return `agentdrive-${name}.md`;
}

export function renderCommand(harness: CommandHarness, name: CommandName): string {
  const t = TEMPLATES[name];
  if (harness === 'gemini-cli') {
    return `description = ${JSON.stringify(t.description)}\nprompt = """\n${t.body.replace(ARGS, '{{args}}')}"""\n`;
  }
  if (harness === 'cursor') {
    return t.body.replace(ARGS, 'the text after the command, if any');
  }
  if (harness === 'antigravity') {
    return `---\nname: agentdrive-${name}\ndescription: ${t.description}\n---\n\n${t.body.replace(ARGS, 'in the user request')}`;
  }
  const body = t.body.replace(ARGS, '$ARGUMENTS');
  const front = [`description: ${t.description}`];
  if (harness !== 'opencode' && t.argumentHint) front.push(`argument-hint: "${t.argumentHint}"`);
  return `---\n${front.join('\n')}\n---\n\n${body}`;
}
