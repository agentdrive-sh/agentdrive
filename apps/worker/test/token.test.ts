import { describe, it, expect } from 'vitest';
import { signToken, verifyToken } from '@agentdrive/shared';
import type { TokenPayload } from '@agentdrive/shared';

const SECRET = 'test-signing-secret-do-not-use-in-prod';
const OTHER_SECRET = 'different-secret-value';

function basePayload(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return {
    v: 1,
    tid: 'tk_test123',
    wid: 'ws_workspace1',
    fid: 'f_file1',
    permission: 'view',
    issuer: 'ag_issuer',
    exp: Math.floor(Date.now() / 1000) + 3600,
    max_uses: 10,
    email: 'user@example.com',
    ...overrides,
  };
}

function isBase64Url(s: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(s);
}

describe('signToken', () => {
  it('produces a two-part base64url string separated by a dot', async () => {
    const token = await signToken(basePayload(), SECRET);
    const parts = token.split('.');
    expect(parts).toHaveLength(2);
    expect(isBase64Url(parts[0])).toBe(true);
    expect(isBase64Url(parts[1])).toBe(true);
  });

  it('embeds the payload version field (v: 1) inside the encoded payload', async () => {
    const token = await signToken(basePayload(), SECRET);
    const [payloadB64] = token.split('.');
    let padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    while (padded.length % 4) padded += '=';
    const decoded = JSON.parse(atob(padded));
    expect(decoded.v).toBe(1);
  });

  it('is deterministic for the same payload and secret', async () => {
    const payload = basePayload();
    const a = await signToken(payload, SECRET);
    const b = await signToken(payload, SECRET);
    expect(a).toBe(b);
  });
});

describe('verifyToken', () => {
  it('rejects a signature that is not base64url instead of throwing', async () => {
    const [payloadB64] = (await signToken(basePayload(), SECRET)).split('.');
    expect(await verifyToken('bad.token', SECRET)).toBeNull();
    expect(await verifyToken(`${payloadB64}.%%%`, SECRET)).toBeNull();
  });

  it('accepts a freshly signed token with the same secret', async () => {
    const payload = basePayload();
    const token = await signToken(payload, SECRET);
    const result = await verifyToken(token, SECRET);
    expect(result).not.toBeNull();
    expect(result?.tid).toBe(payload.tid);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signToken(basePayload(), SECRET);
    const result = await verifyToken(token, OTHER_SECRET);
    expect(result).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const token = await signToken(basePayload(), SECRET);
    const [, sig] = token.split('.');
    const tamperedPayload = btoa(JSON.stringify({ ...basePayload(), permission: 'owner' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const tamperedToken = `${tamperedPayload}.${sig}`;
    const result = await verifyToken(tamperedToken, SECRET);
    expect(result).toBeNull();
  });

  it('rejects a tampered signature', async () => {
    const token = await signToken(basePayload(), SECRET);
    const [payloadB64, sig] = token.split('.');
    const flipped = sig[0] === 'A' ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
    const result = await verifyToken(`${payloadB64}.${flipped}`, SECRET);
    expect(result).toBeNull();
  });

  it('rejects an expired token', async () => {
    const expired = basePayload({ exp: Math.floor(Date.now() / 1000) - 60 });
    const token = await signToken(expired, SECRET);
    const result = await verifyToken(token, SECRET);
    expect(result).toBeNull();
  });

  it('rejects a malformed token (no dot)', async () => {
    const result = await verifyToken('not-a-valid-token', SECRET);
    expect(result).toBeNull();
  });

  it('rejects a malformed token (too many parts)', async () => {
    const result = await verifyToken('a.b.c', SECRET);
    expect(result).toBeNull();
  });

  it('round-trip preserves all TokenPayload fields', async () => {
    const payload = basePayload();
    const token = await signToken(payload, SECRET);
    const result = await verifyToken(token, SECRET);
    expect(result).toEqual(payload);
  });

  it('accepts a token with no expiry', async () => {
    const payload = basePayload({ exp: undefined });
    const token = await signToken(payload, SECRET);
    const result = await verifyToken(token, SECRET);
    expect(result).not.toBeNull();
    expect(result?.exp).toBeUndefined();
  });

  it('accepts a token with no file scope (workspace-wide)', async () => {
    const payload = basePayload({ fid: undefined });
    const token = await signToken(payload, SECRET);
    const result = await verifyToken(token, SECRET);
    expect(result?.fid).toBeUndefined();
    expect(result?.wid).toBe(payload.wid);
  });
});
