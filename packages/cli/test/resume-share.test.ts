import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cmdResumeShare, parseShareToken } from '../src/commands/resume-share.js';

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const TOKEN = `${b64({ v: 1, tid: 'tok_1', wid: 'ws_1', fid: 'f_1', permission: 'view', issuer: 'a' })}.c2lnbmF0dXJl`;

describe('parseShareToken', () => {
  it('reads the token out of agentdrive share URLs', () => {
    expect(parseShareToken(`https://agentdrive.sh/s/${TOKEN}`)).toBe(TOKEN);
    expect(parseShareToken(`https://app.agentdrive.sh/s/${TOKEN}/`)).toBe(TOKEN);
    expect(parseShareToken(`https://agentdrive.sh/s/${TOKEN}?utm_source=x#top`)).toBe(TOKEN);
    expect(parseShareToken(`agentdrive.sh/s/${TOKEN}`)).toBe(TOKEN);
  });

  it('accepts a bare share token', () => {
    expect(parseShareToken(`  ${TOKEN} `)).toBe(TOKEN);
  });

  it('leaves run ids alone', () => {
    expect(parseShareToken('claude-code:3f2a9c')).toBeNull();
    expect(parseShareToken('run_abc123')).toBeNull();
    expect(parseShareToken('codex:rollout-2026.11.10')).toBeNull();
    expect(parseShareToken('a.b')).toBeNull();
  });

  it('rejects URLs that are not agentdrive share links', () => {
    expect(() => parseShareToken(`https://evil.example/s/${TOKEN}`)).toThrow(/Not an AgentDrive share link/);
    expect(() => parseShareToken(`https://agentdrive.sh.evil.example/s/${TOKEN}`)).toThrow(/Not an AgentDrive share link/);
    expect(() => parseShareToken('https://agentdrive.sh/pricing')).toThrow(/Not an AgentDrive share link/);
    expect(() => parseShareToken('https://agentdrive.sh/s/not-a-token')).toThrow(/malformed/);
  });
});

describe('cmdResumeShare', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function firstUrl(fromLink: boolean): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), 'adrive-share-'));
    mkdirSync(join(dir, 'agentdrive'));
    writeFileSync(join(dir, 'agentdrive', 'config.json'), JSON.stringify({ api_url: 'http://localhost:8787', api_key: 'agentdrive_live_x' }));
    vi.stubEnv('XDG_CONFIG_HOME', dir);
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ success: false, error: 'stop' }), { status: 401 });
    });
    await expect(cmdResumeShare(TOKEN, { fromLink })).rejects.toThrow(/no longer works/);
    return calls[0]!;
  }

  it('sends a link to the agentdrive.sh API that issued it, not the configured one', async () => {
    expect(await firstUrl(true)).toBe(`https://app.agentdrive.sh/v1/token-info/${TOKEN}`);
  });

  it('sends a bare token to the configured API', async () => {
    expect(await firstUrl(false)).toBe(`http://localhost:8787/v1/token-info/${TOKEN}`);
  });
});
