import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILL_MARKDOWN } from '../src/lib/skill.js';
import { commandFileName, renderCommand, type CommandName } from '../src/lib/harness-commands.js';

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'plugins', 'agentdrive');

describe('Claude Code plugin drift guards', () => {
  it('SKILL_MARKDOWN is byte-identical to the plugin SKILL.md', () => {
    expect(readFileSync(join(plugin, 'skills', 'agentdrive', 'SKILL.md'), 'utf8')).toBe(SKILL_MARKDOWN);
  });

  it('every plugin command matches what the CLI renders for claude-code', () => {
    const files = readdirSync(join(plugin, 'commands')).sort();
    expect(files).toEqual(['login.md', 'resume.md', 'sessions.md']);
    for (const file of files) {
      const name = file.replace(/\.md$/, '') as CommandName;
      expect(commandFileName('claude-code', name)).toBe(file);
      expect(readFileSync(join(plugin, 'commands', file), 'utf8')).toBe(renderCommand('claude-code', name));
    }
  });

  // The plugin directory blocks unpinned npx launchers, so each release has to move these pins.
  it('pins each package the plugin launches to the version in this repo', () => {
    const versionOf = (dir: string) => JSON.parse(readFileSync(join(plugin, '..', '..', 'packages', dir, 'package.json'), 'utf8')).version as string;
    const pins: Record<string, string> = { cli: versionOf('cli'), 'mcp-server': versionOf('mcp-server') };
    const launched = ['hooks/hooks.json', '.mcp.json'].flatMap((f) => [...readFileSync(join(plugin, f), 'utf8').matchAll(/@adrive\/([a-z-]+)(@[\w.-]+)?/g)]);
    expect(launched).toHaveLength(5);
    for (const [, name, pin] of launched) expect(pin).toBe(`@${pins[name!]}`);
  });
});

describe('SKILL_MARKDOWN content', () => {
  it('starts with name + description frontmatter', () => {
    expect(SKILL_MARKDOWN).toMatch(/^---\nname: agentdrive\ndescription: .+\n---\n/);
  });

  it('leads with sessions before context and search', () => {
    expect(SKILL_MARKDOWN.indexOf('drive_resume')).toBeLessThan(SKILL_MARKDOWN.indexOf('drive_context'));
    expect(SKILL_MARKDOWN).toMatch(/drive_sessions/);
    expect(SKILL_MARKDOWN).toMatch(/drive_search/);
    expect(SKILL_MARKDOWN).toMatch(/drive_write/);
  });

  it('keeps attribution + last_run handling consistent with /v1/context', () => {
    expect(SKILL_MARKDOWN).toMatch(/attribution\.reasons/);
    expect(SKILL_MARKDOWN).toMatch(/last_run/);
  });
});

describe('renderCommand', () => {
  it('uses {{args}} TOML for Gemini and $ARGUMENTS markdown elsewhere', () => {
    const toml = renderCommand('gemini-cli', 'resume');
    expect(toml).toMatch(/^description = ".+"\nprompt = """\n/);
    expect(toml).toContain('{{args}}');
    expect(toml).not.toContain('$ARGUMENTS');
    expect(renderCommand('codex', 'resume')).toContain('argument-hint: "[session-id]"');
    expect(renderCommand('opencode', 'resume')).not.toContain('argument-hint');
    expect(renderCommand('opencode', 'sessions')).toContain('$ARGUMENTS');
    expect(renderCommand('cursor', 'resume').startsWith('Resume earlier agent work')).toBe(true);
  });

  it('prefixes command files in harnesses without a namespace', () => {
    expect(commandFileName('cursor', 'resume')).toBe('agentdrive-resume.md');
    expect(commandFileName('gemini-cli', 'sessions')).toBe('sessions.toml');
  });

  it('renders Antigravity commands as named skills', () => {
    expect(commandFileName('antigravity', 'resume')).toBe('agentdrive-resume/SKILL.md');
    const skill = renderCommand('antigravity', 'sessions');
    expect(skill).toMatch(/^---\nname: agentdrive-sessions\ndescription: .+\n---\n\n/);
    expect(skill).not.toContain('$ARGUMENTS');
    expect(skill).not.toContain('{{ARGS}}');
  });
});
