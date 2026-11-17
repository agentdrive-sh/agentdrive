import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import type { FileMeta, FileVersion } from '@agentdrive/shared';
import {
  resolveLocator,
  defaultObjectKey,
  DEFAULT_STORAGE_LOCATOR,
} from '@agentdrive/shared';

// Phase 4 prereq T-E1 — storage locator schema.
//
// These tests pin the contract that lets BYO-bucket land without breaking
// existing files:
//
// 1. New writes stamp bucket_config_id, provider, object_key, key_version
//    onto BOTH FileMeta and FileVersion.
// 2. Legacy rows (written before T-E1, so missing those fields) read back
//    cleanly — readers MUST treat undefined as the default locator.
// 3. resolveLocator() returns required defaults when the recorded meta is
//    partial — this is the function every future read path will call.

async function clearKv(): Promise<void> {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

interface RegisterOk { success: true; data: { api_key: string; agent_id: string; org_id: string } }

async function registerAgent(): Promise<RegisterOk['data']> {
  const res = await SELF.fetch('http://localhost/v1/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_name: 'LocatorBot' }),
  });
  return ((await res.json()) as RegisterOk).data;
}

function authHeader(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function createWs(key: string): Promise<string> {
  const res = await SELF.fetch('http://localhost/v1/workspaces', {
    method: 'POST',
    headers: authHeader(key),
    body: JSON.stringify({ name: 'loc-ws' }),
  });
  return ((await res.json()) as { data: { id: string } }).data.id;
}

beforeEach(async () => {
  await clearKv();
});

describe('resolveLocator helper', () => {
  it('returns full defaults when nothing is stamped', () => {
    const r = resolveLocator({}, 'abc123');
    expect(r.bucket_config_id).toBe('default');
    expect(r.provider).toBe('agentdrive-r2');
    expect(r.object_key).toBe('content/abc123');
    expect(r.key_version).toBe(1);
  });

  it('respects stamped fields and only fills the gaps', () => {
    const r = resolveLocator(
      { bucket_config_id: 'tenant-x', provider: 's3-hmac', key_version: 2 },
      'def456',
    );
    expect(r.bucket_config_id).toBe('tenant-x');
    expect(r.provider).toBe('s3-hmac');
    expect(r.key_version).toBe(2);
    // object_key was not stamped, so the default kicks in
    expect(r.object_key).toBe('content/def456');
  });

  it('respects a stamped object_key over the default convention', () => {
    const r = resolveLocator({ object_key: 'archive/2026/abc.bin' }, 'abc');
    expect(r.object_key).toBe('archive/2026/abc.bin');
  });
});

describe('defaultObjectKey helper', () => {
  it('returns the canonical content/<hash> key', () => {
    expect(defaultObjectKey('abc')).toBe('content/abc');
  });
});

describe('DEFAULT_STORAGE_LOCATOR constants', () => {
  it('locks the v1 default to the agentdrive-r2 provider in the default bucket', () => {
    expect(DEFAULT_STORAGE_LOCATOR.provider).toBe('agentdrive-r2');
    expect(DEFAULT_STORAGE_LOCATOR.bucket_config_id).toBe('default');
    expect(DEFAULT_STORAGE_LOCATOR.key_version).toBe(1);
  });
});

describe('writeFile stamps the locator onto FileMeta + FileVersion', () => {
  it('new files have locator fields set to the v1 defaults', async () => {
    const agent = await registerAgent();
    const wid = await createWs(agent.api_key);

    const writeRes = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: authHeader(agent.api_key),
      body: JSON.stringify({ path: 'loc/new.md', content: 'hello' }),
    });
    expect(writeRes.status).toBe(201);
    const fileBody = (await writeRes.json()) as { data: { id: string; content_hash: string } };
    const fid = fileBody.data.id;
    const hash = fileBody.data.content_hash;

    const meta = await env.KV.get<FileMeta>(`file:${wid}:${fid}`, 'json');
    expect(meta).not.toBeNull();
    expect(meta!.bucket_config_id).toBe('default');
    expect(meta!.provider).toBe('agentdrive-r2');
    expect(meta!.object_key).toBe(`content/${hash}`);
    expect(meta!.key_version).toBe(1);

    // Version 1 record must carry the same stamp so we can audit which
    // bucket held which historical version.
    const v1 = await env.KV.get<FileVersion>(`ver:${fid}:000001`, 'json');
    expect(v1).not.toBeNull();
    expect(v1!.bucket_config_id).toBe('default');
    expect(v1!.provider).toBe('agentdrive-r2');
    expect(v1!.object_key).toBe(`content/${hash}`);
    expect(v1!.key_version).toBe(1);
  });

  it('updates preserve the locator stamp on the new FileVersion record', async () => {
    const agent = await registerAgent();
    const wid = await createWs(agent.api_key);

    await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: authHeader(agent.api_key),
      body: JSON.stringify({ path: 'loc/edit.md', content: 'one' }),
    });
    const updateRes = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: authHeader(agent.api_key),
      body: JSON.stringify({ path: 'loc/edit.md', content: 'two' }),
    });
    const updateBody = (await updateRes.json()) as {
      data: { id: string; content_hash: string; version: number };
    };
    expect(updateBody.data.version).toBe(2);

    const v2 = await env.KV.get<FileVersion>(
      `ver:${updateBody.data.id}:000002`,
      'json',
    );
    expect(v2).not.toBeNull();
    expect(v2!.provider).toBe('agentdrive-r2');
    expect(v2!.bucket_config_id).toBe('default');
    expect(v2!.object_key).toBe(`content/${updateBody.data.content_hash}`);
    expect(v2!.key_version).toBe(1);
  });
});

describe('legacy file backfill — pre-T-E1 rows read cleanly', () => {
  it('resolveLocator() returns the default locator for a legacy FileMeta with no stamp', async () => {
    // Simulate a row written before T-E1 landed: no locator fields.
    const legacy: FileMeta = {
      id: 'f_legacy',
      workspace_id: 'ws_legacy',
      path: 'old/file.md',
      content_hash: 'legacy-hash',
      size: 12,
      mime_type: 'text/markdown',
      version: 3,
      created_at: '2026-04-01T00:00:00.000Z',
      updated_at: '2026-04-02T00:00:00.000Z',
      created_by: 'ag_legacy',
      updated_by: 'ag_legacy',
    };
    expect(legacy.bucket_config_id).toBeUndefined();
    expect(legacy.provider).toBeUndefined();
    expect(legacy.object_key).toBeUndefined();

    const resolved = resolveLocator(legacy, legacy.content_hash);
    expect(resolved.bucket_config_id).toBe('default');
    expect(resolved.provider).toBe('agentdrive-r2');
    expect(resolved.object_key).toBe('content/legacy-hash');
    expect(resolved.key_version).toBe(1);
  });

  it('resolveLocator() returns defaults for a legacy FileVersion with no stamp', async () => {
    const legacy: FileVersion = {
      version: 1,
      content_hash: 'v1-hash',
      size: 9,
      actor_type: 'agent',
      actor_id: 'ag_legacy',
      created_at: '2026-04-01T00:00:00.000Z',
    };
    const resolved = resolveLocator(legacy, legacy.content_hash);
    expect(resolved.object_key).toBe('content/v1-hash');
    expect(resolved.bucket_config_id).toBe('default');
  });
});
