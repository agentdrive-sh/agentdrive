import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writeAllInstructions,
  removeAllInstructions,
  getInstructionsTargets,
} from './auto-context.js';

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), 'adrive-test-home-'));
}

async function installAllHarnesses(home: string): Promise<void> {
  for (const t of getInstructionsTargets(home)) await fs.mkdir(t.root, { recursive: true });
}

describe('auto-context', () => {
  let home: string;

  beforeEach(() => {
    home = makeHome();
    vi.stubEnv('CODEX_HOME', '');
    vi.stubEnv('XDG_CONFIG_HOME', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('targets $CODEX_HOME and $XDG_CONFIG_HOME/opencode when they are set', async () => {
    const env = { CODEX_HOME: join(home, 'cx'), XDG_CONFIG_HOME: join(home, 'xdg') };
    await fs.mkdir(env.CODEX_HOME, { recursive: true });
    await fs.mkdir(join(env.XDG_CONFIG_HOME, 'opencode'), { recursive: true });
    const results = await writeAllInstructions(home, env);
    expect(results.map((r) => r.path)).toEqual([join(env.CODEX_HOME, 'AGENTS.md'), join(env.XDG_CONFIG_HOME, 'opencode', 'AGENTS.md')]);
  });

  it('writes a fresh instructions block to each installed harness', async () => {
    await installAllHarnesses(home);
    const results = await writeAllInstructions(home);
    expect(results.map((r) => r.path)).toEqual([
      join(home, '.codex', 'AGENTS.md'),
      join(home, '.config', 'opencode', 'AGENTS.md'),
      join(home, '.gemini', 'GEMINI.md'),
      join(home, '.cursor', 'rules', 'agentdrive.mdc'),
    ]);
    for (const r of results) {
      expect(r.action).toBe('created');
      const content = await fs.readFile(r.path, 'utf8');
      expect(content).toMatch(/agentdrive:auto-context:begin/);
      expect(content).toMatch(/drive_resume/);
      expect(content).toMatch(/drive_sessions/);
    }
  });

  it('skips harnesses whose config dir does not exist', async () => {
    await fs.mkdir(join(home, '.gemini'), { recursive: true });
    const results = await writeAllInstructions(home);
    expect(results.map((r) => r.path)).toEqual([join(home, '.gemini', 'GEMINI.md')]);
    await expect(fs.access(join(home, '.codex'))).rejects.toThrow();
  });

  it('is idempotent — re-running reports unchanged', async () => {
    await installAllHarnesses(home);
    await writeAllInstructions(home);
    const second = await writeAllInstructions(home);
    expect(second.every((r) => r.action === 'unchanged')).toBe(true);
  });

  it('appends to an existing file once, backing up the original', async () => {
    const target = join(home, '.codex', 'AGENTS.md');
    await fs.mkdir(join(home, '.codex'), { recursive: true });
    const original = '# Existing user instructions\n\nSome content.\n';
    await fs.writeFile(target, original, 'utf8');
    await writeAllInstructions(home);
    await writeAllInstructions(home);
    const after = await fs.readFile(target, 'utf8');
    expect(after).toMatch(/Existing user instructions/);
    expect(after.match(/agentdrive:auto-context:begin/g)?.length).toBe(1);
    expect(await fs.readFile(`${target}.bak`, 'utf8')).toBe(original);
  });

  it('removes the block when asked, preserving surrounding content', async () => {
    const target = join(home, '.gemini', 'GEMINI.md');
    await fs.mkdir(join(home, '.gemini'), { recursive: true });
    await fs.writeFile(target, '# My notes\n\nUser content here.\n', 'utf8');
    await writeAllInstructions(home);
    await removeAllInstructions(home);
    const final = await fs.readFile(target, 'utf8');
    expect(final).toMatch(/My notes/);
    expect(final).toMatch(/User content here/);
    expect(final).not.toMatch(/agentdrive:auto-context/);
  });

  it('emits cursor MDC frontmatter for the cursor target', async () => {
    await installAllHarnesses(home);
    await writeAllInstructions(home);
    const mdc = await fs.readFile(join(home, '.cursor', 'rules', 'agentdrive.mdc'), 'utf8');
    expect(mdc).toMatch(/alwaysApply: true/);
  });
});
