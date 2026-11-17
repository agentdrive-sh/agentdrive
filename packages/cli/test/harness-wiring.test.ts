import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  OPENCODE_PLUGIN,
  hookCommand,
  removeLegacyClaudeSkill,
  wireHarness,
  type HookHarness,
} from '../src/lib/harness-wiring.js';
import { renderCommand } from '../src/lib/harness-commands.js';
import { SKILL_MARKDOWN } from '../src/lib/skill.js';

const SUPERSET = { type: 'command', command: 'SUPERSET_AGENT_ID=codex "/x/notify.sh"' };
const groupedFixture = { hooks: { SessionStart: [{ hooks: [SUPERSET] }] } };
const cursorFixture = { version: 1, hooks: { sessionStart: [{ command: '/x/cursor-hook.sh SessionStart' }] } };

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(join(tmpdir(), 'adrive-harness-'));
  // wireHarness defaults to process.env; a developer's own overrides must not redirect test writes.
  vi.stubEnv('CODEX_HOME', '');
  vi.stubEnv('XDG_CONFIG_HOME', '');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(home, { recursive: true, force: true });
});

async function writeJson(path: string, value: unknown): Promise<string> {
  const raw = JSON.stringify(value, null, 2);
  await fs.mkdir(join(path, '..'), { recursive: true });
  await fs.writeFile(path, raw, 'utf8');
  return raw;
}

// any: assertions index deep into harness-defined JSON that has no local type.
async function readJson(path: string): Promise<Record<string, any>> {
  return JSON.parse(await fs.readFile(path, 'utf8'));
}

async function expectNoOpRerun(harness: HookHarness): Promise<void> {
  const again = await wireHarness(harness, home);
  expect(again.changed).toEqual([]);
}

describe('wireHarness codex', () => {
  it('appends hooks after foreign ones, writes MCP/prompts/skill, backs up once, and re-runs as a no-op', async () => {
    const hooksPath = join(home, '.codex', 'hooks.json');
    const originalHooks = await writeJson(hooksPath, groupedFixture);
    const tomlPath = join(home, '.codex', 'config.toml');
    await fs.writeFile(tomlPath, 'model = "gpt-5"\nnotify = ["/x/notify.sh"]\n', 'utf8');

    const first = await wireHarness('codex', home);
    expect(first.changed).toHaveLength(5);

    const hooks = (await readJson(hooksPath)).hooks;
    expect(hooks.SessionStart).toEqual([
      { hooks: [SUPERSET] },
      { hooks: [{ type: 'command', command: hookCommand('codex'), timeout: 3 }] },
    ]);
    for (const event of ['Stop', 'SessionEnd', 'PreCompact']) {
      expect(hooks[event][0].hooks[0].command).toBe(hookCommand('codex'));
    }
    expect(await fs.readFile(`${hooksPath}.bak`, 'utf8')).toBe(originalHooks);
    expect((await fs.stat(`${hooksPath}.bak`)).mode & 0o777).toBe(0o600);

    const toml = await fs.readFile(tomlPath, 'utf8');
    expect(toml).toContain('notify = ["/x/notify.sh"]');
    expect(toml).toContain('[mcp_servers.agentdrive.env]\nAGENTDRIVE_AGENT_PLATFORM = "codex"');
    expect(toml).toContain('[mcp_servers.agentdrive.tools.drive_resume]\napproval_mode = "approve"');
    expect(toml).not.toContain('API_KEY');

    expect(await fs.readFile(join(home, '.codex', 'prompts', 'agentdrive-resume.md'), 'utf8')).toBe(renderCommand('codex', 'resume'));
    expect(await fs.readFile(join(home, '.codex', 'prompts', 'agentdrive-sessions.md'), 'utf8')).toBe(renderCommand('codex', 'sessions'));
    expect(await fs.readFile(join(home, '.codex', 'skills', 'agentdrive', 'SKILL.md'), 'utf8')).toBe(SKILL_MARKDOWN);

    await expectNoOpRerun('codex');
    expect(await fs.readFile(`${hooksPath}.bak`, 'utf8')).toBe(originalHooks);
  });

  it('replaces an outdated AgentDrive hook in place instead of stacking a second one', async () => {
    const hooksPath = join(home, '.codex', 'hooks.json');
    await writeJson(hooksPath, {
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'adrive hook codex --old' }] }, { hooks: [SUPERSET] }] },
    });
    await wireHarness('codex', home);
    const stop = (await readJson(hooksPath)).hooks.Stop;
    expect(stop).toHaveLength(2);
    expect(stop[0].hooks[0].command).toBe(hookCommand('codex'));
    expect(stop[1]).toEqual({ hooks: [SUPERSET] });
  });

  it('wires $CODEX_HOME instead of ~/.codex when it is set', async () => {
    const codexHome = join(home, 'custom-codex');
    await wireHarness('codex', home, { CODEX_HOME: codexHome });
    expect((await readJson(join(codexHome, 'hooks.json'))).hooks.Stop[0].hooks[0].command).toBe(hookCommand('codex'));
    expect(await fs.readFile(join(codexHome, 'config.toml'), 'utf8')).toContain('[mcp_servers.agentdrive]');
    await expect(fs.access(join(home, '.codex'))).rejects.toThrow();
  });
});

describe('wireHarness gemini-cli', () => {
  it('merges hooks (ms timeouts) and MCP into settings.json and writes TOML commands', async () => {
    const settingsPath = join(home, '.gemini', 'settings.json');
    await writeJson(settingsPath, { ...groupedFixture, theme: 'Dracula', mcpServers: { other: { command: 'x' } } });

    await wireHarness('gemini-cli', home);
    const settings = await readJson(settingsPath);
    expect(settings.theme).toBe('Dracula');
    expect(Object.keys(settings.mcpServers)).toEqual(['other', 'agentdrive']);
    expect(settings.mcpServers.agentdrive.env).toEqual({ AGENTDRIVE_AGENT_PLATFORM: 'gemini-cli' });
    expect(settings.hooks.SessionStart[0]).toEqual({ hooks: [SUPERSET] });
    expect(settings.hooks.SessionStart[1]).toEqual({
      matcher: '*',
      hooks: [{ type: 'command', command: hookCommand('gemini-cli'), timeout: 10000, name: 'agentdrive' }],
    });
    expect(Object.keys(settings.hooks)).toEqual(['SessionStart', 'AfterAgent', 'SessionEnd', 'PreCompress']);
    expect(await fs.readFile(join(home, '.gemini', 'commands', 'agentdrive', 'resume.toml'), 'utf8')).toBe(
      renderCommand('gemini-cli', 'resume'),
    );
    await expect(fs.access(join(home, '.gemini', 'skills'))).rejects.toThrow();

    await expectNoOpRerun('gemini-cli');
  });
});

describe('wireHarness antigravity', () => {
  it('adds a named hook and MCP entry under ~/.gemini/config, keeps foreign entries, and writes skills', async () => {
    const root = join(home, '.gemini', 'config');
    const foreign = { 'lint-checker': { PostToolUse: [{ matcher: 'run_command', hooks: [{ command: './lint.sh' }] }] } };
    await writeJson(join(root, 'hooks.json'), foreign);
    await fs.writeFile(join(root, 'mcp_config.json'), '', 'utf8');

    await wireHarness('antigravity', home);
    const hooks = await readJson(join(root, 'hooks.json'));
    expect(hooks['lint-checker']).toEqual(foreign['lint-checker']);
    expect(hooks.agentdrive).toEqual({
      SessionStart: [{ type: 'command', command: hookCommand('antigravity', 'SessionStart'), timeout: 10 }],
      Stop: [{ type: 'command', command: hookCommand('antigravity', 'Stop'), timeout: 10 }],
    });
    expect(hookCommand('antigravity', 'Stop')).toContain('adrive hook antigravity --event Stop');
    const mcp = await readJson(join(root, 'mcp_config.json'));
    expect(mcp.mcpServers.agentdrive.env).toEqual({ AGENTDRIVE_AGENT_PLATFORM: 'antigravity' });
    expect(await fs.readFile(join(root, 'skills', 'agentdrive-resume', 'SKILL.md'), 'utf8')).toBe(renderCommand('antigravity', 'resume'));
    expect(await fs.readFile(join(root, 'skills', 'agentdrive-sessions', 'SKILL.md'), 'utf8')).toBe(renderCommand('antigravity', 'sessions'));
    expect(await fs.readFile(join(root, 'skills', 'agentdrive', 'SKILL.md'), 'utf8')).toBe(SKILL_MARKDOWN);

    await expectNoOpRerun('antigravity');
  });

  it('keeps foreign MCP servers and a user-disabled AgentDrive hook disabled', async () => {
    const root = join(home, '.gemini', 'config');
    await writeJson(join(root, 'mcp_config.json'), { mcpServers: { other: { command: 'x' } } });
    await writeJson(join(root, 'hooks.json'), { agentdrive: { enabled: false, Stop: [{ command: 'adrive hook antigravity --old' }] } });

    await wireHarness('antigravity', home);
    expect(Object.keys((await readJson(join(root, 'mcp_config.json'))).mcpServers)).toEqual(['other', 'agentdrive']);
    const ours = (await readJson(join(root, 'hooks.json'))).agentdrive;
    expect(ours.enabled).toBe(false);
    expect(ours.Stop[0].command).toBe(hookCommand('antigravity', 'Stop'));
    await expectNoOpRerun('antigravity');
  });
});

describe('wireHarness cursor', () => {
  it('appends flat hooks, merges mcp.json without a key, and writes commands + skill', async () => {
    const hooksPath = join(home, '.cursor', 'hooks.json');
    const original = await writeJson(hooksPath, cursorFixture);
    await writeJson(join(home, '.cursor', 'mcp.json'), { mcpServers: { other: { command: 'x' } } });

    await wireHarness('cursor', home);
    const hooks = await readJson(hooksPath);
    expect(hooks.version).toBe(1);
    expect(hooks.hooks.sessionStart).toEqual([
      { command: '/x/cursor-hook.sh SessionStart' },
      { command: hookCommand('cursor'), timeout: 10 },
    ]);
    expect(Object.keys(hooks.hooks)).toEqual(['sessionStart', 'stop', 'sessionEnd', 'preCompact']);
    expect(await fs.readFile(`${hooksPath}.bak`, 'utf8')).toBe(original);

    const mcp = await readJson(join(home, '.cursor', 'mcp.json'));
    expect(Object.keys(mcp.mcpServers)).toEqual(['other', 'agentdrive']);
    expect(JSON.stringify(mcp)).not.toContain('API_KEY');
    expect(await fs.readFile(join(home, '.cursor', 'commands', 'agentdrive-resume.md'), 'utf8')).toBe(renderCommand('cursor', 'resume'));
    expect(await fs.readFile(join(home, '.cursor', 'skills', 'agentdrive', 'SKILL.md'), 'utf8')).toBe(SKILL_MARKDOWN);

    await expectNoOpRerun('cursor');
  });

  it('leaves an unparseable hooks.json untouched and reports why', async () => {
    const hooksPath = join(home, '.cursor', 'hooks.json');
    await fs.mkdir(join(home, '.cursor'), { recursive: true });
    await fs.writeFile(hooksPath, '{ "version": 1, // comment\n}', 'utf8');
    await expect(wireHarness('cursor', home)).rejects.toThrow(/not plain JSON/);
    expect(await fs.readFile(hooksPath, 'utf8')).toBe('{ "version": 1, // comment\n}');
  });
});

describe('wireHarness opencode', () => {
  it('creates opencode.json MCP, the plugin, commands, and skill', async () => {
    const root = join(home, '.config', 'opencode');
    await writeJson(join(root, 'opencode.json'), { $schema: 'https://opencode.ai/config.json', theme: 'tokyonight' });

    const first = await wireHarness('opencode', home);
    expect(first.warnings).toEqual([]);
    const cfg = await readJson(join(root, 'opencode.json'));
    expect(cfg.theme).toBe('tokyonight');
    expect(cfg.mcp.agentdrive.environment).toEqual({ AGENTDRIVE_AGENT_PLATFORM: 'opencode' });
    expect(await fs.readFile(join(root, 'plugins', 'agentdrive.ts'), 'utf8')).toBe(OPENCODE_PLUGIN);
    expect(await fs.readFile(join(root, 'commands', 'agentdrive-sessions.md'), 'utf8')).toBe(renderCommand('opencode', 'sessions'));
    expect(await fs.readFile(join(root, 'skills', 'agentdrive', 'SKILL.md'), 'utf8')).toBe(SKILL_MARKDOWN);

    await expectNoOpRerun('opencode');
  });

  it('skips the MCP merge with a warning when only an opencode.jsonc with comments exists', async () => {
    const root = join(home, '.config', 'opencode');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(join(root, 'opencode.jsonc'), '// mine\n{}\n', 'utf8');
    const result = await wireHarness('opencode', home);
    expect(result.warnings[0]).toMatch(/opencode\.jsonc/);
    await expect(fs.access(join(root, 'opencode.json'))).rejects.toThrow();
    expect(await fs.readFile(join(root, 'opencode.jsonc'), 'utf8')).toBe('// mine\n{}\n');
  });

  it('merges into a plain-JSON opencode.jsonc, as a fresh OpenCode writes it', async () => {
    const root = join(home, '.config', 'opencode');
    await writeJson(join(root, 'opencode.jsonc'), { $schema: 'https://opencode.ai/config.json' });
    const result = await wireHarness('opencode', home);
    expect(result.warnings).toEqual([]);
    const cfg = await readJson(join(root, 'opencode.jsonc'));
    expect(cfg.$schema).toBe('https://opencode.ai/config.json');
    expect(cfg.mcp.agentdrive.environment).toEqual({ AGENTDRIVE_AGENT_PLATFORM: 'opencode' });
    await expect(fs.access(join(root, 'opencode.json'))).rejects.toThrow();
    await expectNoOpRerun('opencode');
  });

  it('wires $XDG_CONFIG_HOME/opencode when XDG_CONFIG_HOME is set', async () => {
    const xdg = join(home, 'xdg');
    await wireHarness('opencode', home, { XDG_CONFIG_HOME: xdg });
    expect((await readJson(join(xdg, 'opencode', 'opencode.json'))).mcp.agentdrive.type).toBe('local');
    expect(await fs.readFile(join(xdg, 'opencode', 'plugins', 'agentdrive.ts'), 'utf8')).toBe(OPENCODE_PLUGIN);
    await expect(fs.access(join(home, '.config'))).rejects.toThrow();
  });
});

describe('removeLegacyClaudeSkill', () => {
  const dir = () => join(home, '.claude', 'skills', 'agentdrive');

  it('removes the skill CLI 1.0.0 wrote and keeps anything else in its folder', async () => {
    await fs.mkdir(dir(), { recursive: true });
    await fs.writeFile(join(dir(), 'SKILL.md'), SKILL_MARKDOWN, 'utf8');
    expect(await removeLegacyClaudeSkill(home)).toBe(join(dir(), 'SKILL.md'));
    await expect(fs.access(dir())).rejects.toThrow();

    await fs.mkdir(dir(), { recursive: true });
    await fs.writeFile(join(dir(), 'SKILL.md'), '---\nname: agentdrive\ndescription: old\n---\n', 'utf8');
    await fs.writeFile(join(dir(), 'notes.md'), 'mine', 'utf8');
    await removeLegacyClaudeSkill(home);
    expect(await fs.readdir(dir())).toEqual(['notes.md']);
  });

  it('leaves a SKILL.md that is not AgentDrive\'s untouched', async () => {
    await fs.mkdir(dir(), { recursive: true });
    const foreign = '---\nname: agentdrive-helper\ndescription: mine\n---\nname: agentdrive\n';
    await fs.writeFile(join(dir(), 'SKILL.md'), foreign, 'utf8');
    expect(await removeLegacyClaudeSkill(home)).toBeNull();
    expect(await fs.readFile(join(dir(), 'SKILL.md'), 'utf8')).toBe(foreign);
    await fs.rm(join(home, '.claude'), { recursive: true });
    expect(await removeLegacyClaudeSkill(home)).toBeNull();
  });

  it('never deletes through a linked skill folder', async () => {
    const shared = join(home, 'shared-skills', 'agentdrive');
    await fs.mkdir(shared, { recursive: true });
    await fs.writeFile(join(shared, 'SKILL.md'), SKILL_MARKDOWN, 'utf8');
    await fs.mkdir(join(home, '.claude', 'skills'), { recursive: true });
    await fs.symlink(shared, dir());
    expect(await removeLegacyClaudeSkill(home)).toBeNull();
    expect(await fs.readFile(join(shared, 'SKILL.md'), 'utf8')).toBe(SKILL_MARKDOWN);
  });
});

describe('OpenCode plugin runtime', () => {
  type Plugin = (ctx: { directory: string }) => Promise<{ event: (arg: { event: unknown }) => Promise<void> }>;

  async function loadPlugin(): Promise<Plugin> {
    const js = ts.transpileModule(OPENCODE_PLUGIN, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
    });
    expect(js.diagnostics ?? []).toEqual([]);
    const file = join(home, 'agentdrive-plugin.mjs');
    await fs.writeFile(file, js.outputText, 'utf8');
    const mod = (await import(pathToFileURL(file).href)) as { AgentDrive: Plugin; default: { id: string; server: Plugin } };
    expect(mod.default.id).toBe('agentdrive');
    expect(mod.default.server).toBe(mod.AgentDrive);
    return mod.AgentDrive;
  }

  // One file per spawned hook: concurrent appends to a shared file interleave.
  async function waitForPayloads(dir: string, count: number): Promise<unknown[]> {
    for (let i = 0; i < 100; i++) {
      const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
      if (files.length >= count) {
        await new Promise((r) => setTimeout(r, 100));
        const all = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
        return Promise.all(all.map(async (f) => JSON.parse(await fs.readFile(join(dir, f), 'utf8'))));
      }
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error(`timed out waiting for ${count} payloads in ${dir}`);
  }

  it('hands top-level session events to `adrive hook opencode` and skips subagent sessions', async () => {
    const bin = join(home, 'bin');
    const out = join(home, 'payloads');
    await fs.mkdir(bin);
    await fs.mkdir(out);
    await fs.writeFile(
      join(bin, 'adrive'),
      `#!/bin/sh\n[ "$1 $2" = "hook opencode" ] || exit 1\ncat > "${out}/$$.tmp" && mv "${out}/$$.tmp" "${out}/$$.json"\n`,
      { mode: 0o755 },
    );
    const savedPath = process.env.PATH;
    process.env.PATH = `${bin}:${savedPath}`;
    try {
      const hooks = await (await loadPlugin())({ directory: '/work/proj' });
      await hooks.event({ event: { type: 'session.created', properties: { info: { id: 'ses_child', parentID: 'ses_parent' } } } });
      await hooks.event({ event: { type: 'session.created', properties: { info: { id: 'ses_1', directory: '/work/other' } } } });
      await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'ses_1' } } });
      await hooks.event({ event: { type: 'message.updated', properties: {} } });
      const lines = await waitForPayloads(out, 2);
      expect(lines).toEqual(
        expect.arrayContaining([
          { hook_event_name: 'session.created', session_id: 'ses_1', cwd: '/work/other' },
          { hook_event_name: 'session.idle', session_id: 'ses_1', cwd: '/work/proj' },
        ]),
      );
      expect(lines).toHaveLength(2);
    } finally {
      process.env.PATH = savedPath;
    }
  });

  it('falls back to npx when adrive is not on PATH', async () => {
    const bin = join(home, 'npx-bin');
    const out = join(home, 'npx-payloads');
    await fs.mkdir(bin);
    await fs.mkdir(out);
    await fs.writeFile(
      join(bin, 'npx'),
      `#!/bin/sh\n[ "$*" = "-y @adrive/cli hook opencode" ] || exit 1\ncat > "${out}/$$.tmp" && mv "${out}/$$.tmp" "${out}/$$.json"\n`,
      { mode: 0o755 },
    );
    const savedPath = process.env.PATH;
    process.env.PATH = `${bin}:/usr/bin:/bin`;
    try {
      const hooks = await (await loadPlugin())({ directory: '/work/proj' });
      await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'ses_1' } } });
      expect(await waitForPayloads(out, 1)).toEqual([{ hook_event_name: 'session.idle', session_id: 'ses_1', cwd: '/work/proj' }]);
    } finally {
      process.env.PATH = savedPath;
    }
  });

  it('does nothing when neither adrive nor npx is on PATH', async () => {
    const savedPath = process.env.PATH;
    process.env.PATH = join(home, 'empty');
    try {
      const hooks = await (await loadPlugin())({ directory: '/work/proj' });
      await expect(
        hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'ses_1' } } }),
      ).resolves.toBeUndefined();
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      process.env.PATH = savedPath;
    }
  });
});
