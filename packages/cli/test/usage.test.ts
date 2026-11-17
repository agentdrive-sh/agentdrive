import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cmdUpgrade, upgradeUrl } from '../src/commands/upgrade.js';
import { cmdPlan } from '../src/commands/plan.js';
import { cmdResume } from '../src/commands/resume.js';
import { runHook } from '../src/commands/hook.js';
import { ApiError } from '../src/lib/api-client.js';
import { runSync, type SyncClient, type SyncOptions } from '../src/lib/sync.js';
import type { TranscriptSource } from '@adrive/mcp-server/transcripts/types';

vi.mock('open', () => ({ default: vi.fn(async () => undefined) }));

const PRO = 'https://agentdrive.sh/billing/upgrade?plan=pro';
const TEAM = 'https://agentdrive.sh/billing/upgrade?plan=team';
const PAUSED = `AgentDrive is paused: your Free plan's storage is full (1 of 1 GB). New files and sessions won't sync until you upgrade: ${PRO}. Everything you've stored stays readable.`;
const WARN = `AgentDrive: your Free plan has used 92% of its storage (0.92 of 1 GB). Upgrade to Pro: ${PRO}`;

let root: string;
let cfgDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'adrive-usage-test-'));
  vi.stubEnv('XDG_CONFIG_HOME', root);
  cfgDir = join(root, 'agentdrive');
  await fs.mkdir(cfgDir, { recursive: true });
  await fs.writeFile(
    join(cfgDir, 'config.json'),
    JSON.stringify({
      api_url: 'https://example.invalid',
      api_key: 'agentdrive_live_test',
      default_workspace: 'ws_1',
      preferences: { auto_context: false, capture_transcripts: true, capture_artifacts: false, private_workspace: false },
    }),
  );
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('upgradeUrl', () => {
  it('opens the named plan', async () => {
    const current = vi.fn(async () => TEAM);
    expect(await upgradeUrl('pro', current)).toBe(PRO);
    expect(await upgradeUrl('team', current)).toBe(TEAM);
    expect(current).not.toHaveBeenCalled();
  });

  it('defaults to the next tier the server names, including enterprise contact', async () => {
    expect(await upgradeUrl(undefined, async () => TEAM)).toBe(TEAM);
    const mail = 'mailto:hello@agentdrive.sh?subject=AgentDrive%20Enterprise';
    expect(await upgradeUrl(undefined, async () => mail)).toBe(mail);
  });

  it('falls back to Pro when the plan cannot be read', async () => {
    expect(await upgradeUrl(undefined, async () => undefined)).toBe(PRO);
    expect(await upgradeUrl(undefined, async () => { throw new Error('offline'); })).toBe(PRO);
  });

  it('gives up on a hung status fetch and opens Pro', { timeout: 2000 }, async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort());
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        if (init?.signal?.aborted) reject(init.signal.reason);
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      }),
    );
    const out = await captureStdout(() => cmdUpgrade());
    expect(timeout).toHaveBeenCalledWith(5000);
    expect(out).toContain(PRO);
  });

  it('rejects an unknown plan', async () => {
    await expect(upgradeUrl('gold', async () => undefined)).rejects.toThrow(/pro or team/);
  });

  it('passes team seats through, and rejects them out of range or off team', async () => {
    expect(await upgradeUrl('team', async () => undefined, '8')).toBe(`${TEAM}&seats=8`);
    for (const bad of ['2', '101', '3.5', 'many']) {
      await expect(upgradeUrl('team', async () => undefined, bad)).rejects.toThrow(/3 to 100/);
    }
    await expect(upgradeUrl('pro', async () => undefined, '5')).rejects.toThrow(/team plan/);
    await expect(upgradeUrl(undefined, async () => undefined, '5')).rejects.toThrow(/team plan/);
  });
});

function planResponse(status: Record<string, unknown>) {
  return new Response(JSON.stringify({ success: true, data: { plan: 'trial', usage: {}, quota: {}, status } }));
}

const metric = (used: number, limit: number, pct: number, level: string) => ({ used, limit, pct, level });

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  let out = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    out += String(chunk);
    return true;
  });
  await fn();
  return out;
}

describe('adrive plan', () => {
  const metrics = (storage: number, level: string) => ({
    storage_bytes: metric(storage, 1024 ** 3, Math.round((storage / 1024 ** 3) * 100), level),
    embedding_count: metric(340, 10_000, 3, 'ok'),
    agent_count: metric(2, 3, 67, 'ok'),
    workspace_count: metric(1, 1, 100, 'paused'),
    member_count: metric(1, 1, 100, 'paused'),
  });

  it('shows used, limit, percent and level per metric, and the upgrade link at 80% and over', async () => {
    vi.stubGlobal('fetch', async () =>
      planResponse({ plan: 'trial', plan_name: 'Free', level: 'warn90', message: WARN, upgrade_url: PRO, metrics: metrics(Math.ceil(0.92 * 1024 ** 3), 'warn90') }),
    );
    const out = await captureStdout(() => cmdPlan());
    expect(out).toContain('Free');
    expect(out).toMatch(/storage\s+942\.1 MB\s+1 GB\s+92%\s+warn90/);
    expect(out).toMatch(/embeddings\s+340\s+10,000\s+3%\s+ok/);
    // A count cap reached shows as full.
    expect(out).toMatch(/workspaces\s+1\s+1\s+100%\s+full/);
    expect(out).toContain(WARN);
    expect(out).toContain(`Upgrade: ${PRO}`);
  });

  it('falls back to the usage and quota table against a worker that sends no status', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ success: true, data: { plan: 'trial', usage: { storage_bytes: 5, agent_count: 2 }, quota: { storage_bytes: 1024 ** 3, max_agents: 3 } } })),
    );
    const out = await captureStdout(() => cmdPlan());
    expect(out).toContain('Plan: trial');
    expect(out).toMatch(/metric\s+usage\s+quota/);
    expect(out).toMatch(/storage_bytes\s+5\s+1,073,741,824/);
    expect(out).toMatch(/max_agents\s+0\s+3/);
  });

  it('labels the cross-agent resume meter', async () => {
    vi.stubGlobal('fetch', async () =>
      planResponse({
        plan: 'trial',
        plan_name: 'Free',
        level: 'ok',
        upgrade_url: PRO,
        metrics: { ...metrics(1024 ** 2, 'ok'), resume_count: { used: 7, limit: 10, pct: 70, level: 'ok' } },
      }),
    );
    const out = await captureStdout(() => cmdPlan());
    expect(out).toMatch(/cross-agent resumes this month\s+7\s+10\s+70%\s+ok/);
  });

  it('leaves the upgrade link out below 80%', async () => {
    vi.stubGlobal('fetch', async () =>
      planResponse({ plan: 'trial', plan_name: 'Free', level: 'ok', upgrade_url: PRO, metrics: metrics(1024 ** 2, 'ok') }),
    );
    const out = await captureStdout(() => cmdPlan());
    expect(out).toMatch(/storage\s+1 MB\s+1 GB/);
    expect(out).not.toContain('Upgrade:');
  });
});

describe('SessionStart usage line', () => {
  const start = () => JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's', cwd: root });

  it('puts the recorded warning or pause in front of the agent on one line', async () => {
    await fs.writeFile(join(cfgDir, 'usage-notice.json'), JSON.stringify({ level: 'paused', message: PAUSED, upgrade_url: PRO }));
    const out = JSON.parse(await runHook('claude-code', start(), { spawnSync: () => undefined }));
    expect(out.hookSpecificOutput.additionalContext).toBe(PAUSED);
  });

  it('adds nothing when no notice is recorded', async () => {
    expect(await runHook('claude-code', start(), { spawnSync: () => undefined })).toBe('');
  });
});

describe('adrive resume', () => {
  const RESUME_WARN = `AgentDrive: your Free plan has used 8 of 10 cross-agent resumes this month. Upgrade to Pro: ${PRO}`;
  const transcript = '# Session\n\n## user\n\nfix the build\n';

  function stubServer(usageWarning: Record<string, string>) {
    vi.stubGlobal('fetch', async (url: string) => {
      const path = new URL(url).pathname + new URL(url).search;
      const data = path.startsWith('/v1/runs/')
        ? { run_id: 'codex:s1', workspace_id: 'ws_1', agent_platform: 'codex', task: 't', metadata: { transcript_path: 'sessions/s1.md' }, artifacts_produced: [] }
        : path.includes('content=true')
          ? { id: 'f_1', path: 'sessions/s1.md', content: transcript, version: 1, updated_at: '' }
          : [{ id: 'f_1', path: 'sessions/s1.md' }];
      const warning = path.includes('content=true') ? { usage_warning: usageWarning } : {};
      return new Response(JSON.stringify({ success: true, data, ...warning }));
    });
  }

  it('prints the resume meter warning to stderr and keeps the handoff on stdout', async () => {
    stubServer({ metric: 'resume_count', level: 'warn80', message: RESUME_WARN, upgrade_url: PRO });
    let err = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      err += String(chunk);
      return true;
    });
    const out = await captureStdout(() => cmdResume('codex:s1'));
    expect(err).toBe(`${RESUME_WARN}\n`);
    expect(out).toContain('fix the build');
    expect(out).not.toContain(RESUME_WARN);
  });

  it('adds the upgrade link when the warning lacks it', async () => {
    stubServer({ metric: 'resume_count', level: 'warn80', message: 'Most resumes used.', upgrade_url: PRO });
    let err = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      err += String(chunk);
      return true;
    });
    await captureStdout(() => cmdResume('codex:s1'));
    expect(err).toBe(`Most resumes used.\nUpgrade: ${PRO}\n`);
  });
});

describe('sync on plan_limit and rate_limited', () => {
  const home = () => join(root, 'home');
  let writes: string[];
  let attempts: number;
  let paused: boolean;
  let limited: boolean;
  let warning: Record<string, string> | undefined;

  const client = {
    async writeFile(_ws: string, path: string) {
      attempts++;
      if (paused) throw new ApiError(PAUSED, 402, 'plan_limit', PRO);
      if (limited) throw new ApiError('AgentDrive is rate limiting this key; try again in 10 seconds.', 429, 'rate_limited');
      writes.push(path);
      return { id: `f_${writes.length}`, path, version: 1, updated_at: '' };
    },
    async logRun(body: Record<string, unknown>) {
      return { run_id: String(body.run_id), created_at: 0, usage_warning: warning };
    },
    async listWorkspaces() {
      return [];
    },
  } as unknown as SyncClient;

  const noSource = (platform: TranscriptSource['platform']): TranscriptSource => ({ platform, enumerate: async () => [], parseSession: async () => null });

  function opts(now: number): SyncOptions {
    return {
      home: home(),
      env: {},
      configDir: cfgDir,
      quiet: true,
      clientFor: () => client,
      sources: { opencode: noSource('opencode') },
      autoWire: async () => [],
      all: true,
      now,
    };
  }

  async function session(id: string): Promise<void> {
    const dir = join(home(), '.claude/projects/proj');
    await fs.mkdir(dir, { recursive: true });
    const line = JSON.stringify({ type: 'user', cwd: home(), message: { role: 'user', content: `task ${id}` } });
    await fs.writeFile(join(dir, `${id}.jsonl`), `${line}\n`);
  }

  const notice = async () => JSON.parse(await fs.readFile(join(cfgDir, 'usage-notice.json'), 'utf8')) as { level: string; message: string };
  const log = () => fs.readFile(join(cfgDir, 'sync.log'), 'utf8');

  beforeEach(async () => {
    writes = [];
    attempts = 0;
    paused = true;
    limited = false;
    warning = undefined;
    await session('a');
    await session('b');
  });

  it('stops at the first refusal, logs the pause once, records it, and resumes when writes are allowed', async () => {
    const first = await runSync(opts(1_800_000_000_000));
    expect(first.paused).toBe(PAUSED);
    expect(first.synced).toEqual([]);
    expect(first.failed).toBe(0);
    expect(attempts).toBe(1);
    expect(await notice()).toMatchObject({ level: 'paused', message: PAUSED });

    await runSync(opts(1_800_000_300_000));
    expect(attempts).toBe(2);
    expect((await log()).split(PAUSED).length - 1).toBe(1);

    paused = false;
    const resumed = await runSync(opts(1_800_000_600_000));
    expect(resumed.paused).toBeUndefined();
    expect(resumed.synced.sort()).toEqual(['claude-code:a', 'claude-code:b']);
    await expect(fs.access(join(cfgDir, 'usage-notice.json'))).rejects.toThrow();
  });

  it('stops the pass on rate_limited and keeps every session for the next sync', async () => {
    paused = false;
    limited = true;
    const first = await runSync(opts(1_800_000_000_000));
    expect(first.rateLimited).toBe(true);
    expect(first.paused).toBeUndefined();
    expect(first.failed).toBe(0);
    expect(attempts).toBe(1);
    expect(await log()).toContain('rate limiting this key');

    limited = false;
    const resumed = await runSync(opts(1_800_000_300_000));
    expect(resumed.rateLimited).toBeUndefined();
    expect(resumed.synced.sort()).toEqual(['claude-code:a', 'claude-code:b']);
  });

  it('records a usage warning from a successful sync so the next session start shows it', async () => {
    paused = false;
    warning = { level: 'warn90', message: WARN, upgrade_url: PRO };
    await runSync(opts(1_800_000_000_000));
    expect(await notice()).toMatchObject({ level: 'warn90', message: WARN });
  });
});
