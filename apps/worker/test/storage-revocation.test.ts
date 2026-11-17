import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { signToken } from '@agentdrive/shared';
import type { TokenPayload, ShareTokenMeta } from '@agentdrive/shared';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    KV: KVNamespace;
    R2: R2Bucket;
    FILE_COLLAB: DurableObjectNamespace;
    ENVIRONMENT: string;
    APP_URL: string;
    TOKEN_SIGNING_SECRET: string;
  }
}

async function clearKv() {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

function makePayload(tid: string, overrides: Partial<TokenPayload> = {}): TokenPayload {
  return {
    v: 1,
    tid,
    wid: 'ws_test',
    fid: 'f_test',
    permission: 'view',
    issuer: 'ag_test',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

function makeMeta(tid: string, overrides: Partial<ShareTokenMeta> = {}): ShareTokenMeta {
  return {
    token_id: tid,
    workspace_id: 'ws_test',
    file_id: 'f_test',
    permission: 'view',
    issuer: 'ag_test',
    created_at: new Date().toISOString(),
    use_count: 0,
    revoked: false,
    ...overrides,
  };
}

beforeEach(async () => {
  await clearKv();
});

describe('share token KV round-trip', () => {
  it('writes a share token to token:<tid> and reads it back', async () => {
    const meta = makeMeta('tk_roundtrip');
    await env.KV.put(`token:${meta.token_id}`, JSON.stringify(meta));
    const read = await env.KV.get<ShareTokenMeta>(`token:${meta.token_id}`, 'json');
    expect(read).toEqual(meta);
  });
});

describe('revocation via flexAuth share path', () => {
  it('returns 401 when token is revoked in KV', async () => {
    const tid = 'tk_revoked';
    const meta = makeMeta(tid, { revoked: true });
    await env.KV.put(`token:${tid}`, JSON.stringify(meta));
    const token = await signToken(makePayload(tid), env.TOKEN_SIGNING_SECRET);

    const res = await SELF.fetch(`http://localhost/v1/workspaces/ws_test/files?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/revoked/i);
  });

  it('returns 401 when use_count >= max_uses', async () => {
    const tid = 'tk_maxed';
    const meta = makeMeta(tid, { max_uses: 1, use_count: 1 });
    await env.KV.put(`token:${tid}`, JSON.stringify(meta));
    const token = await signToken(makePayload(tid), env.TOKEN_SIGNING_SECRET);

    const res = await SELF.fetch(`http://localhost/v1/workspaces/ws_test/files?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/usage limit/i);
  });

  it('returns 401 when the token meta is missing entirely (token never issued)', async () => {
    const tid = 'tk_missing';
    const token = await signToken(makePayload(tid), env.TOKEN_SIGNING_SECRET);
    const res = await SELF.fetch(`http://localhost/v1/workspaces/ws_test/files?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(401);
  });

  it('public /v1/token-info also rejects revoked tokens', async () => {
    const tid = 'tk_info_revoked';
    const meta = makeMeta(tid, { revoked: true });
    await env.KV.put(`token:${tid}`, JSON.stringify(meta));
    const token = await signToken(makePayload(tid), env.TOKEN_SIGNING_SECRET);

    const res = await SELF.fetch(`http://localhost/v1/token-info/${encodeURIComponent(token)}`);
    expect(res.status).toBe(401);
  });
});
