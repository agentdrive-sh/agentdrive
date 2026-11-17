import { describe, expect, it } from 'vitest';
import { detectHarness, resumeAgentPlatform } from '../src/lib/harness-env.js';

const env = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv;

describe('detectHarness', () => {
  it.each([
    ['claude-code', { CLAUDE_CODE_CHILD_SESSION: '1' }],
    ['codex', { CODEX_THREAD_ID: '019a0000-0000-7000-8000-000000000000' }],
    ['opencode', { OPENCODE: '1' }],
    ['gemini-cli', { GEMINI_CLI: '1' }],
    ['cursor', { CURSOR_AGENT: '1' }],
  ])('detects %s', (platform, vars) => {
    expect(detectHarness(env(vars))).toBe(platform);
  });

  it('returns undefined in a plain shell', () => {
    expect(detectHarness(env({ PATH: '/usr/bin', TERM: 'xterm' }))).toBeUndefined();
  });

  it('ignores CLAUDECODE alone, which IDE-integrated terminals also set', () => {
    expect(detectHarness(env({ CLAUDECODE: '1' }))).toBeUndefined();
  });

  it('requires the exact value for markers the harness sets to 1', () => {
    expect(detectHarness(env({ OPENCODE: '0', GEMINI_CLI: '', CLAUDE_CODE_CHILD_SESSION: 'true' }))).toBeUndefined();
  });

  it('ignores empty values for presence markers', () => {
    expect(detectHarness(env({ CODEX_THREAD_ID: '', CURSOR_AGENT: '' }))).toBeUndefined();
  });
});

describe('resumeAgentPlatform', () => {
  it('prefers the explicit AGENTDRIVE_AGENT_PLATFORM', () => {
    expect(resumeAgentPlatform(env({ AGENTDRIVE_AGENT_PLATFORM: 'antigravity', CODEX_THREAD_ID: 't' }), 'cli')).toBe('antigravity');
  });

  it('uses the detected harness over the config value', () => {
    expect(resumeAgentPlatform(env({ GEMINI_CLI: '1' }), 'cli')).toBe('gemini-cli');
  });

  it('falls back to the config value, then cli', () => {
    expect(resumeAgentPlatform(env({}), 'codex')).toBe('codex');
    expect(resumeAgentPlatform(env({}), undefined)).toBe('cli');
  });
});
