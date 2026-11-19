import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyEvent, runHook } from '../src/commands/hook.js';

let root: string;
let prevXdg: string | undefined;
let spawned: string[][];
const spawnSync = (args: string[]) => void spawned.push(args);

async function writeConfig(extra: Record<string, unknown> = {}) {
  const dir = join(root, 'agentdrive');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    join(dir, 'config.json'),
    JSON.stringify({
      api_url: 'https://example.invalid',
      api_key: 'agentdrive_live_test',
      preferences: { auto_context: true, capture_transcripts: true, capture_artifacts: false, private_workspace: false },
      ...extra,
    }),
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'adrive-hook-test-'));
  prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = root;
  spawned = [];
});

afterEach(async () => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('classifyEvent', () => {
  it('maps every harness event name', () => {
    for (const e of ['SessionStart', 'sessionStart', 'session.created']) expect(classifyEvent(e)).toBe('start');
    // OpenCode's idle stands in for the end event it never sends, so it skips the debounce too.
    for (const e of ['SessionEnd', 'sessionEnd', 'PreCompact', 'preCompact', 'PreCompress', 'session.idle']) expect(classifyEvent(e)).toBe('force');
    for (const e of ['Stop', 'stop', 'AfterAgent']) expect(classifyEvent(e)).toBe('turn');
    expect(classifyEvent('afterFileEdit')).toBe('file-edit');
    expect(classifyEvent('UserPromptSubmit')).toBe('other');
  });
});

describe('runHook', () => {
  it('never throws on garbage stdin and prints {} only for JSON-protocol harnesses', async () => {
    for (const raw of ['garbage', '', '[1,2]', 'null', '{"hook_event_name":42}']) {
      expect(await runHook('claude-code', raw, { spawnSync })).toBe('');
      expect(await runHook('codex', raw, { spawnSync })).toBe('');
      expect(await runHook('opencode', raw, { spawnSync })).toBe('');
      expect(await runHook('gemini-cli', raw, { spawnSync })).toBe('{}');
      expect(await runHook('cursor', raw, { spawnSync })).toBe('{}');
      expect(await runHook('antigravity', raw, { spawnSync })).toBe('{}');
    }
    expect(await runHook('not-a-harness', '{}', { spawnSync })).toBe('');
    expect(spawned).toEqual([]);
  });

  it('tells the agent it is not connected when no API key is configured', async () => {
    const start = (event: string) => JSON.stringify({ hook_event_name: event, session_id: 's', cwd: root });
    const claude = JSON.parse(await runHook('claude-code', start('SessionStart'), { spawnSync }));
    expect(claude.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(claude.hookSpecificOutput.additionalContext).toContain('not connected');
    const cursor = JSON.parse(await runHook('cursor', JSON.stringify({ hook_event_name: 'sessionStart', conversation_id: 'c' }), { spawnSync }));
    expect(cursor.additional_context).toContain('npx -y @adrive/cli init --yes');
    expect(await runHook('opencode', start('session.created'), { spawnSync })).toBe('');
    expect(spawned).toEqual([]);
  });

  it('shows the auto-wire notice once at the next session start', async () => {
    await writeConfig({ preferences: { auto_context: false, capture_transcripts: true, capture_artifacts: false, private_workspace: false } });
    await fs.writeFile(join(root, 'agentdrive', 'autowired.json'), JSON.stringify(['Cursor']));
    const start = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's', cwd: root });
    const first = JSON.parse(await runHook('claude-code', start, { spawnSync }));
    expect(first.hookSpecificOutput.additionalContext).toContain('connected newly installed agent tools: Cursor');
    expect(await runHook('claude-code', start, { spawnSync })).not.toContain('Cursor');
  });

  it('still starts the session-start sync with capture off, so new tools get wired', async () => {
    await writeConfig({ preferences: { auto_context: false, capture_transcripts: false, capture_artifacts: false, private_workspace: false } });
    const start = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's', cwd: root });
    await runHook('claude-code', start, { spawnSync });
    expect(spawned.at(-1)).toContain('--start');
    spawned = [];
    await runHook('claude-code', JSON.stringify({ hook_event_name: 'Stop', session_id: 's', cwd: root }), { spawnSync });
    expect(spawned).toEqual([]);
    await writeConfig({ preferences: { auto_context: false, capture_transcripts: false, capture_artifacts: false, private_workspace: false, auto_wire: false } });
    await runHook('claude-code', start, { spawnSync });
    expect(spawned).toEqual([]);
  });

  it('leaves the auto-wire notice for a harness that can show it', async () => {
    await writeConfig();
    await fs.writeFile(join(root, 'agentdrive', 'autowired.json'), JSON.stringify(['Cursor']));
    await runHook('opencode', JSON.stringify({ hook_event_name: 'session.created', session_id: 's', cwd: root }), { spawnSync });
    expect(await fs.readFile(join(root, 'agentdrive', 'autowired.json'), 'utf8')).toContain('Cursor');
  });

  it('injects recent sessions on start, dropping the current one, then spawns a sweep', async () => {
    await writeConfig();
    const now = 1_800_000_000_000;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [
            { run_id: 'claude-code:current', agent_platform: 'claude-code', task: 'this one', metadata: {}, created_at: now },
            { run_id: 'codex:abc', agent_platform: 'codex', task: 'task', metadata: { title: 'Add auth' }, created_at: now - 7_200_000 },
          ],
          cursor: null,
        }),
      ),
    );
    const payload = { hook_event_name: 'SessionStart', session_id: 'current', transcript_path: '/t/current.jsonl', cwd: root };
    const out = JSON.parse(await runHook('claude-code', JSON.stringify(payload), { spawnSync, now }));
    const context: string = out.hookSpecificOutput.additionalContext;
    expect(context).toContain('- codex · 2h ago · "Add auth" (id codex:abc)');
    expect(context).not.toContain('claude-code:current');
    expect(context).toContain('drive_resume');
    const url = String(fetchSpy.mock.calls[0]![0]);
    expect(url).toMatch(/\/v1\/runs\?project=local__/);
    expect(spawned).toEqual([['--quiet', '--harness', 'claude-code', '--session', 'current', '--transcript', '/t/current.jsonl', '--cwd', root, '--start']]);
  });

  it('keeps the newest session of each other harness in view when one harness has many newer runs', async () => {
    await writeConfig();
    const now = 1_800_000_000_000;
    const run = (platform: string, id: string, minutesAgo: number) => ({ run_id: `${platform}:${id}`, agent_platform: platform, task: id, metadata: {}, created_at: now - minutesAgo * 60_000 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [run('codex', 'c1', 1), run('codex', 'c2', 2), run('codex', 'c3', 3), run('codex', 'c4', 4), run('claude-code', 'old', 30), run('gemini-cli', 'g', 60)],
          cursor: null,
        }),
      ),
    );
    const out = JSON.parse(await runHook('codex', JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'c0', cwd: root }), { spawnSync, now }));
    const ids = [...String(out.hookSpecificOutput.additionalContext).matchAll(/\(id ([^)]+)\)/g)].map((m) => m[1]);
    expect(ids).toEqual(['codex:c1', 'claude-code:old', 'gemini-cli:g']);
  });

  it('maps an OpenCode idle event to a forced sync', async () => {
    await writeConfig();
    await runHook('opencode', JSON.stringify({ hook_event_name: 'session.idle', session_id: 'ses_1', cwd: root }), { spawnSync });
    expect(spawned).toEqual([['--quiet', '--harness', 'opencode', '--session', 'ses_1', '--cwd', root, '--force']]);
  });

  it('prints {} for gemini when there are no prior sessions and maps end/turn events to sync flags', async () => {
    await writeConfig();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, data: [], cursor: null })));
    expect(await runHook('gemini-cli', JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'g', cwd: root }), { spawnSync })).toBe('{}');
    expect(await runHook('gemini-cli', JSON.stringify({ hook_event_name: 'PreCompress', session_id: 'g', cwd: root }), { spawnSync })).toBe('{}');
    expect(await runHook('codex', JSON.stringify({ hook_event_name: 'Stop', session_id: 'x', transcript_path: null, cwd: root }), { spawnSync })).toBe('');
    expect(spawned[1]).toContain('--force');
    expect(spawned[2]).toEqual(['--quiet', '--harness', 'codex', '--session', 'x', '--cwd', root]);
  });

  it('takes the antigravity event from --event, injects context as a system message, and prints {} on Stop', async () => {
    await writeConfig();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: [{ run_id: 'codex:abc', agent_platform: 'codex', task: 'Add auth', metadata: {}, created_at: Date.now() }], cursor: null })),
    );
    const payload = { conversationId: 'conv-a', workspacePaths: ['/work/a', '/work/b'], transcriptPath: '/brain/conv-a/transcript.jsonl', modelName: 'm' };
    const out = JSON.parse(await runHook('antigravity', JSON.stringify(payload), { spawnSync, event: 'SessionStart' }));
    expect(Object.keys(out)).toEqual(['injectSteps']);
    expect(out.injectSteps[0].systemMessage.systemMessage).toContain('(id codex:abc)');
    expect(spawned[0]).toEqual(['--quiet', '--harness', 'antigravity', '--session', 'conv-a', '--transcript', '/brain/conv-a/transcript.jsonl', '--cwd', '/work/a', '--start']);

    expect(await runHook('antigravity', JSON.stringify({ ...payload, executionNum: 1, fullyIdle: true }), { spawnSync, event: 'Stop' })).toBe('{}');
    expect(spawned[1]).toEqual(['--quiet', '--harness', 'antigravity', '--session', 'conv-a', '--transcript', '/brain/conv-a/transcript.jsonl', '--cwd', '/work/a']);
    expect(JSON.parse(await fs.readFile(join(root, 'agentdrive', 'session-cwd.json'), 'utf8'))).toEqual({ 'antigravity:conv-a': '/work/a' });
  });

  it('never uses the hook process cwd as an antigravity session cwd', async () => {
    await writeConfig();
    await runHook('antigravity', JSON.stringify({ conversationId: 'conv-b' }), { spawnSync, event: 'Stop' });
    expect(spawned[0]).toEqual(['--quiet', '--harness', 'antigravity', '--session', 'conv-b']);
  });

  it('records the cursor workspace root on every event and does not sync on afterFileEdit', async () => {
    await writeConfig();
    const out = await runHook(
      'cursor',
      JSON.stringify({ hook_event_name: 'afterFileEdit', conversation_id: 'conv-9', workspace_roots: ['/work/c'] }),
      { spawnSync },
    );
    expect(out).toBe('{}');
    expect(spawned).toEqual([]);
    const map = JSON.parse(await fs.readFile(join(root, 'agentdrive', 'session-cwd.json'), 'utf8'));
    expect(map).toEqual({ 'cursor:conv-9': '/work/c' });

    await runHook('cursor', JSON.stringify({ hook_event_name: 'stop', conversation_id: 'conv-9', workspace_roots: ['/work/c'] }), { spawnSync });
    expect(spawned[0]).toEqual(['--quiet', '--harness', 'cursor', '--session', 'conv-9', '--cwd', '/work/c']);
  });

  it('records each session cwd for every harness, keeping only the newest 500', async () => {
    await writeConfig();
    await runHook('gemini-cli', JSON.stringify({ hook_event_name: 'BeforeTool', session_id: 'g1', cwd: '/work/g' }), { spawnSync });
    await runHook('codex', JSON.stringify({ hook_event_name: 'Stop', session_id: 'x1', cwd: '/work/x' }), { spawnSync });
    const path = join(root, 'agentdrive', 'session-cwd.json');
    expect(JSON.parse(await fs.readFile(path, 'utf8'))).toEqual({ 'gemini-cli:g1': '/work/g', 'codex:x1': '/work/x' });

    const full = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`codex:s${i}`, `/w/${i}`]));
    await fs.writeFile(path, JSON.stringify(full));
    await runHook('codex', JSON.stringify({ hook_event_name: 'Stop', session_id: 'newest', cwd: '/w/new' }), { spawnSync });
    const map = JSON.parse(await fs.readFile(path, 'utf8'));
    expect(Object.keys(map)).toHaveLength(500);
    expect(map['codex:s0']).toBeUndefined();
    expect(map['codex:newest']).toBe('/w/new');
  });

  it('does not spawn a sync when capture and auto-wire are off, but still records the cwd for local resume', async () => {
    await writeConfig({ preferences: { auto_context: false, capture_transcripts: false, capture_artifacts: false, private_workspace: false, auto_wire: false } });
    expect(await runHook('claude-code', JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's', cwd: root }), { spawnSync })).toBe('');
    expect(spawned).toEqual([]);
    expect(JSON.parse(await fs.readFile(join(root, 'agentdrive', 'session-cwd.json'), 'utf8'))).toEqual({ 'claude-code:s': root });
  });

  it('records sync left off by an older CLI as off since 0, and closes that interval once sync is on', async () => {
    const off = { auto_context: false, capture_transcripts: false, capture_artifacts: false, private_workspace: false, auto_wire: false };
    await writeConfig({ capture_notice_at: '2026-01-01T00:00:00.000Z', preferences: off });
    const stop = JSON.stringify({ hook_event_name: 'Stop', session_id: 's', cwd: root });
    await runHook('claude-code', stop, { spawnSync });
    const history = () => fs.readFile(join(root, 'agentdrive', 'privacy-history.json'), 'utf8').then(JSON.parse);
    expect(await history()).toEqual({ transcripts_off: [{ at: 0, until: null }], artifacts_off: [{ at: 0, until: null }] });
    expect(spawned).toEqual([]);

    await writeConfig({ capture_notice_at: '2026-01-01T00:00:00.000Z', preferences: { ...off, capture_transcripts: true } });
    const before = Date.now();
    await runHook('claude-code', stop, { spawnSync });
    const after = await history();
    expect(after.transcripts_off[0].until).toBeGreaterThanOrEqual(before);
    expect(after.artifacts_off).toEqual([{ at: 0, until: null }]);
  });
});
