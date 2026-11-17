import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const installerDir = resolve(here, '..');
const repoRoot = resolve(installerDir, '..', '..');
const installShPath = resolve(installerDir, 'install.sh');
const buildScriptPath = resolve(installerDir, 'build.mjs');
const generatedPath = resolve(repoRoot, 'apps', 'worker', 'src', 'generated', 'install-script.ts');

describe('install.sh', () => {
  const sh = readFileSync(installShPath, 'utf8');

  it('starts with a /bin/sh shebang', () => {
    expect(sh.startsWith('#!/bin/sh\n')).toBe(true);
  });

  it('is POSIX sh (no bashisms)', () => {
    expect(sh).not.toMatch(/\[\[/);
    expect(sh).not.toMatch(/\]\]/);
    expect(sh).not.toMatch(/\(\(/);
    expect(sh).not.toMatch(/function\s+\w+\s*\(\)\s*\{/);
  });

  it('passes sh -n syntax check', () => {
    const result = spawnSync('sh', ['-n', installShPath], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  });

  it('points at the canonical package name and binary', () => {
    expect(sh).toMatch(/PKG_NAME="@adrive\/cli"/);
    expect(sh).toMatch(/BIN_NAME="adrive"/);
  });

  it('declares set -eu for safety', () => {
    expect(sh).toMatch(/^set -eu$/m);
  });

  it('tells users how to review the script before piping it', () => {
    expect(sh).toContain('# Review before piping to sh: curl -fsSL agentdrive.sh/install | less');
  });

  it('runs init against the terminal so prompts work under curl | sh', () => {
    expect(sh).toMatch(/^\s+"\$BIN_NAME" init <\/dev\/tty$/m);
    expect(sh).toContain('[ -r /dev/tty ] && (: </dev/tty) 2>/dev/null');
  });

  it('leaves Claude Code setup to the plugin instead of writing a skill file', () => {
    expect(sh).not.toMatch(/install_claude_skill|SKILL\.md|\.claude/);
  });

  it('skips init cleanly when no terminal can be opened', async () => {
    // detached = new session with no controlling terminal, as under CI or cron.
    const child = spawn(
      'sh',
      ['-c', `if [ -r /dev/tty ] && (: </dev/tty) 2>/dev/null; then echo tty; else echo none; fi`],
      { stdio: ['ignore', 'pipe', 'pipe'], detached: true },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    await new Promise((resolve) => child.on('close', resolve));
    expect(stdout.trim()).toBe('none');
    expect(stderr).toBe('');
  });

  it('requires Node 22.15 or newer', () => {
    const fn = sh.match(/^node_version_ok\(\) \{[\s\S]*?^\}$/m);
    expect(fn).not.toBeNull();
    const ok = (v: string) =>
      spawnSync('sh', ['-c', `NODE_MIN_MAJOR=22; NODE_MIN_MINOR=15; ${fn![0]}\nnode_version_ok "$1"`, 'sh', v]).status === 0;
    for (const v of ['22.15.0', '22.20.1', '23.0.0', '24.1.0']) expect(ok(v), v).toBe(true);
    for (const v of ['22.14.0', '22.0.0', '20.19.0', '', 'garbage', '22']) expect(ok(v), v).toBe(false);
  });

  it('stays under a reasonable size budget', () => {
    const lines = sh.split('\n').length;
    expect(lines).toBeLessThan(300);
  });
});

describe('build.mjs', () => {
  beforeAll(() => {
    execFileSync(process.execPath, [buildScriptPath], { stdio: 'pipe' });
  });

  it('produces the generated install-script.ts', () => {
    expect(existsSync(generatedPath)).toBe(true);
  });

  it('embeds the install.sh contents verbatim', () => {
    const generated = readFileSync(generatedPath, 'utf8');
    const sh = readFileSync(installShPath, 'utf8');
    const match = generated.match(/export const INSTALL_SCRIPT: string = ("(?:[^"\\]|\\.)*");/s);
    expect(match).not.toBeNull();
    const decoded = JSON.parse(match![1]);
    expect(decoded).toBe(sh);
  });

  it('records a sha256 of the source', () => {
    const generated = readFileSync(generatedPath, 'utf8');
    expect(generated).toMatch(/export const INSTALL_SCRIPT_SHA256 = "[0-9a-f]{64}";/);
  });
});
