import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { StorageService } from '../src/services/storage';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    KV: KVNamespace;
    R2: R2Bucket;
  }
}

// Regression test pinning Codex F6 / Phase 0 deliverable #5.
//
// BEFORE: `previousHash` was read after `file:*` metadata had already been
// overwritten with the new content_hash, so the cleanup branch never fired —
// every UPDATE leaked an idx:content_refs entry (and, in production, a
// Vectorize embedding) for the prior content_hash.
//
// AFTER: `previousHash` is captured from the pre-overwrite `current` read.
// This test asserts the old ref is removed when content_hash changes.
//
// A future change that re-reads previousHash after the put() will break this
// test loudly. Do not delete this test even if the file looks "obvious."
async function clearKv(): Promise<void> {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

describe('StorageService writeFile ref-count', () => {
  beforeEach(async () => {
    await clearKv();
  });

  it('removes the old content_hash ref when an UPDATE changes the hash', async () => {
    const storage = new StorageService(env.KV, env.R2);

    const first = await storage.writeFile(
      'ws_refcount',
      'plan.md',
      'first',
      'agent',
      'ag_test',
    );
    const firstHash = first.content_hash;
    expect(typeof firstHash).toBe('string');

    const firstRef = await env.KV.get(`idx:content_refs:${firstHash}:ws_refcount:${first.id}`);
    expect(firstRef).toBe('1');

    const second = await storage.writeFile(
      'ws_refcount',
      'plan.md',
      'second',
      'agent',
      'ag_test',
    );
    expect(second.id).toBe(first.id);
    expect(second.version).toBe(2);
    expect(second.content_hash).not.toBe(firstHash);

    const newRef = await env.KV.get(`idx:content_refs:${second.content_hash}:ws_refcount:${first.id}`);
    expect(newRef).toBe('1');

    const oldRef = await env.KV.get(`idx:content_refs:${firstHash}:ws_refcount:${first.id}`);
    expect(oldRef).toBeNull();
  });

  it('keeps a single ref when an UPDATE does NOT change the hash (idempotent re-write)', async () => {
    const storage = new StorageService(env.KV, env.R2);

    const first = await storage.writeFile('ws_refcount', 'plan.md', 'same', 'agent', 'ag_test');
    const second = await storage.writeFile('ws_refcount', 'plan.md', 'same', 'agent', 'ag_test');
    expect(second.content_hash).toBe(first.content_hash);

    const ref = await env.KV.get(`idx:content_refs:${first.content_hash}:ws_refcount:${first.id}`);
    expect(ref).toBe('1');
    const allRefs = await env.KV.list({ prefix: `idx:content_refs:` });
    expect(allRefs.keys.length).toBe(1);
  });

  it('creates a ref on the first write', async () => {
    const storage = new StorageService(env.KV, env.R2);
    const file = await storage.writeFile('ws_refcount', 'note.md', 'hello', 'agent', 'ag_test');
    const ref = await env.KV.get(`idx:content_refs:${file.content_hash}:ws_refcount:${file.id}`);
    expect(ref).toBe('1');
  });
});
