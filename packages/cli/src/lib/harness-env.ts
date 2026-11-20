// Each marker is set by the harness itself on the commands its agent runs. A
// harness without a documented marker is left out: a wrong guess would count
// a same-harness or human resume as a cross-harness one. Antigravity documents
// none (https://antigravity.google/docs/hooks), so `adrive resume --as antigravity` names it.
const HARNESS_MARKERS: ReadonlyArray<{ platform: string; name: string; value?: string }> = [
  // https://code.claude.com/docs/en/env-vars (unlike CLAUDECODE, not set in IDE-integrated terminals)
  { platform: 'claude-code', name: 'CLAUDE_CODE_CHILD_SESSION', value: '1' },
  // https://github.com/openai/codex/blob/main/codex-rs/core/src/unified_exec/process_manager.rs
  { platform: 'codex', name: 'CODEX_THREAD_ID' },
  // https://github.com/anomalyco/opencode/blob/dev/packages/core/src/tool/plugin/shell.ts
  { platform: 'opencode', name: 'OPENCODE', value: '1' },
  // https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/shell.md
  { platform: 'gemini-cli', name: 'GEMINI_CLI', value: '1' },
  // https://cursor.com/docs/agent/tools/terminal
  { platform: 'cursor', name: 'CURSOR_AGENT' },
];

export function detectHarness(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return HARNESS_MARKERS.find(({ name, value }) => (value === undefined ? !!env[name] : env[name] === value))?.platform;
}

export function resumeAgentPlatform(env: NodeJS.ProcessEnv, configured: string | undefined): string {
  return env.AGENTDRIVE_AGENT_PLATFORM || detectHarness(env) || configured || 'cli';
}
