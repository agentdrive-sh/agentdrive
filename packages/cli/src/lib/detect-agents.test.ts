import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getAgentTargets,
  mergeCodexToml,
  mergeContinueJson,
  mergeMcpJson,
  mergeOpencodeJson,
  mergeZedJson,
  wireAgent,
} from './detect-agents.js';

describe('mergeMcpJson', () => {
  it('creates an agentdrive entry with the platform and no API key', () => {
    const out = mergeMcpJson(null, 'claude-code');
    const ad = (out.mcpServers as Record<string, Record<string, unknown>>).agentdrive!;
    expect(ad.command).toBe('npx');
    expect(ad.args).toEqual(['-y', '@adrive/mcp-server']);
    expect(ad.env).toEqual({ AGENTDRIVE_AGENT_PLATFORM: 'claude-code' });
  });

  it('preserves other servers and keys, and replaces a stale agentdrive entry', () => {
    const out = mergeMcpJson(
      {
        mcpServers: { other: { command: 'node' }, agentdrive: { command: 'old', env: { AGENTDRIVE_API_KEY: 'k' } } },
        someOtherKey: 'preserve me',
      },
      'cline',
    );
    expect(out.someOtherKey).toBe('preserve me');
    expect(out.mcpServers).toHaveProperty('other');
    expect(JSON.stringify(out)).not.toContain('AGENTDRIVE_API_KEY');
  });
});

describe('mergeZedJson + mergeContinueJson + mergeOpencodeJson', () => {
  it('zed uses context_servers map shape', () => {
    const out = mergeZedJson({ theme: 'one-dark' });
    expect(out.theme).toBe('one-dark');
    expect(out).toHaveProperty('context_servers.agentdrive');
  });

  it('continue keeps one agentdrive entry in its array shape', () => {
    const out = mergeContinueJson({ mcpServers: [{ name: 'other' }, { name: 'agentdrive', command: 'stale' }] });
    const arr = out.mcpServers as Array<Record<string, unknown>>;
    expect(arr.map((s) => s.name)).toEqual(['other', 'agentdrive']);
    expect(arr[1]!.command).toBe('npx');
  });

  it('opencode uses the mcp map with a local command array', () => {
    const out = mergeOpencodeJson({ theme: 'x', mcp: { other: { type: 'remote' } } });
    expect(out.theme).toBe('x');
    expect((out.mcp as Record<string, unknown>).other).toEqual({ type: 'remote' });
    expect((out.mcp as Record<string, unknown>).agentdrive).toEqual({
      type: 'local',
      command: ['npx', '-y', '@adrive/mcp-server'],
      environment: { AGENTDRIVE_AGENT_PLATFORM: 'opencode' },
      enabled: true,
    });
  });
});

describe('mergeCodexToml', () => {
  const block =
    '[mcp_servers.agentdrive]\ncommand = "npx"\nargs = ["-y", "@adrive/mcp-server"]\n\n' +
    '[mcp_servers.agentdrive.env]\nAGENTDRIVE_AGENT_PLATFORM = "codex"\n' +
    '\n[mcp_servers.agentdrive.tools.drive_sessions]\napproval_mode = "approve"\n' +
    '\n[mcp_servers.agentdrive.tools.drive_resume]\napproval_mode = "approve"\n';

  it('writes the table form into an empty file', () => {
    expect(mergeCodexToml('')).toBe(block);
  });

  it('pre-approves only the read-only session tools for codex exec', () => {
    const approved = [...mergeCodexToml('').matchAll(/^\[mcp_servers\.agentdrive\.tools\.([a-z_]+)\]\napproval_mode = "approve"$/gm)].map((m) => m[1]);
    expect(approved).toEqual(['drive_sessions', 'drive_resume']);
    expect(mergeCodexToml('')).not.toMatch(/trusted_hash|\[hooks/);
  });

  it('keeps foreign tables verbatim and is idempotent', () => {
    const existing = 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\n\n[features]\nfoo = true\n';
    const once = mergeCodexToml(existing);
    expect(once).toBe(`${existing}\n${block}`);
    expect(mergeCodexToml(once)).toBe(once);
  });

  it('replaces the legacy [[mcp_servers]] agentdrive block that held the API key', () => {
    const existing =
      'model = "gpt-5"\n\n[[mcp_servers]]\nname = "agentdrive"\ncommand = "npx"\n' +
      'env = { AGENTDRIVE_API_KEY = "agentdrive_live_x", AGENTDRIVE_AGENT_PLATFORM = "codex" }\n';
    const out = mergeCodexToml(existing);
    expect(out).toBe(`model = "gpt-5"\n\n${block}`);
  });

  it('keeps approvals the user added for other agentdrive tools across re-runs', () => {
    const mine = '[mcp_servers.agentdrive.tools.drive_write]\napproval_mode = "approve"\n';
    const once = mergeCodexToml(mergeCodexToml(''));
    const withMine = mergeCodexToml(`${once}\n${mine}`);
    expect(withMine).toBe(`${mine}\n${block}`);
    expect(mergeCodexToml(withMine)).toBe(withMine);
  });

  it('replaces a stale agentdrive table in place of duplicating it', () => {
    const out = mergeCodexToml('[mcp_servers.agentdrive]\ncommand = "stale"\n\n[mcp_servers.agentdrive.env]\nAGENTDRIVE_API_KEY = "k"\n');
    expect(out).toBe(block);
  });
});

describe('getAgentTargets', () => {
  it('lists MCP-only clients; harnesses with hooks are wired elsewhere', () => {
    const names = getAgentTargets({ home: '/tmp/home', osPlatform: 'darwin' }).map((t) => t.name);
    expect(names).toEqual(['claude-desktop', 'continue', 'zed', 'cline']);
  });

  it('resolves Linux configs under XDG_CONFIG_HOME and keeps Zed on macOS in ~/.config', () => {
    const paths = (osPlatform: NodeJS.Platform) =>
      Object.fromEntries(getAgentTargets({ home: '/h', osPlatform, env: { XDG_CONFIG_HOME: '/x' } }).map((t) => [t.name, t.configPath]));
    const linux = paths('linux');
    expect(linux['claude-desktop']).toBe('/x/Claude/claude_desktop_config.json');
    expect(linux.zed).toBe('/x/zed/settings.json');
    expect(linux.cline).toMatch(/^\/x\/Code\//);
    expect(paths('darwin').zed).toBe('/h/.config/zed/settings.json');
  });
});

describe('wireAgent file I/O', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'adrive-test-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('merges into an existing file, backs it up once, and is a no-op on re-run', async () => {
    const cfg = join(dir, 'claude_desktop_config.json');
    const original = JSON.stringify({ mcpServers: { other: { command: 'x' } } });
    await fs.writeFile(cfg, original, 'utf8');
    const target = { name: 'claude-desktop', configPath: cfg, format: 'mcp-json' as const, platform: 'claude-code' };
    expect(await wireAgent(target)).toBe('updated');
    expect(await wireAgent(target)).toBe('unchanged');
    const parsed = JSON.parse(await fs.readFile(cfg, 'utf8')) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(parsed.mcpServers)).toEqual(['other', 'agentdrive']);
    expect(await fs.readFile(`${cfg}.bak`, 'utf8')).toBe(original);
  });

  it('refuses to rewrite a JSONC file it cannot parse', async () => {
    const cfg = join(dir, 'settings.json');
    const jsonc = '// zed settings\n{ "theme": "one-dark" }\n';
    await fs.writeFile(cfg, jsonc, 'utf8');
    await expect(
      wireAgent({ name: 'zed', configPath: cfg, format: 'zed-json', platform: 'zed' }),
    ).rejects.toThrow(/not plain JSON/);
    expect(await fs.readFile(cfg, 'utf8')).toBe(jsonc);
  });
});
