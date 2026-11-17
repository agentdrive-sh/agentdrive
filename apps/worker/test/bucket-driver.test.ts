import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { R2DefaultDriver } from '../src/services/bucket-driver/r2-default.js';
import {
  getBucketDriver,
  resolveBucketTarget,
  resolveDefaultWriteTarget,
} from '../src/services/bucket-driver/index.js';

// Phase 4 step 2 — BucketDriver factory + R2 default driver.
//
// The contract:
//   - getBucketDriver(env, undefined) -> default driver (legacy locator)
//   - getBucketDriver(env, { provider: 'agentdrive-r2' }) -> default driver
//   - getBucketDriver(env, { provider: 'cf-r2-cross-account' }) -> throws
//   - getBucketDriver(env, { provider: 's3-hmac' }) -> throws
//   - resolveBucketTarget always returns a usable object_key (default
//     content/<hash> when not stamped)
//   - resolveDefaultWriteTarget returns the canonical write surface for
//     new files
//   - R2DefaultDriver.head/get/put/delete round-trip against the real R2
//     binding in the test pool

async function clearR2(): Promise<void> {
  const list = await env.R2.list();
  await Promise.all(list.objects.map((o) => env.R2.delete(o.key)));
}

beforeEach(async () => {
  await clearR2();
});

describe('getBucketDriver factory', () => {
  it('returns R2DefaultDriver for undefined locator (legacy file)', () => {
    const d = getBucketDriver(env, undefined);
    expect(d.provider).toBe('agentdrive-r2');
    expect(d.bucketConfigId).toBe('default');
  });

  it('returns R2DefaultDriver for provider=agentdrive-r2', () => {
    const d = getBucketDriver(env, { provider: 'agentdrive-r2' });
    expect(d.provider).toBe('agentdrive-r2');
  });

  it('throws "requires an s3 config" for cf-r2-cross-account without config (Phase 4 step 5 wiring)', () => {
    expect(() => getBucketDriver(env, { provider: 'cf-r2-cross-account' })).toThrow(
      /requires an s3 config/i,
    );
  });

  it('throws "requires an s3 config" for s3-hmac without config', () => {
    expect(() => getBucketDriver(env, { provider: 's3-hmac' })).toThrow(/requires an s3 config/i);
  });
});

describe('resolveBucketTarget', () => {
  it('returns the default content/<hash> object_key when locator is empty', () => {
    const { driver, objectKey } = resolveBucketTarget(env, {}, 'abc');
    expect(driver.provider).toBe('agentdrive-r2');
    expect(objectKey).toBe('content/abc');
  });

  it('respects a stamped object_key over the default convention', () => {
    const { objectKey } = resolveBucketTarget(env, { object_key: 'custom/key.bin' }, 'abc');
    expect(objectKey).toBe('custom/key.bin');
  });
});

describe('resolveDefaultWriteTarget', () => {
  it('returns the v1 default driver + canonical key for new writes', () => {
    const { driver, objectKey } = resolveDefaultWriteTarget(env, 'beef');
    expect(driver.provider).toBe('agentdrive-r2');
    expect(objectKey).toBe('content/beef');
  });
});

describe('R2DefaultDriver round-trip', () => {
  it('head returns null for a missing object', async () => {
    const d = new R2DefaultDriver(env.R2);
    expect(await d.head('content/missing')).toBeNull();
  });

  it('put then head returns size; get returns the body', async () => {
    const d = new R2DefaultDriver(env.R2);
    await d.put('content/abc', 'hello world', { contentType: 'text/markdown' });
    const head = await d.head('content/abc');
    expect(head).not.toBeNull();
    expect(head!.size).toBe('hello world'.length);

    const obj = await d.get('content/abc');
    expect(obj).not.toBeNull();
    expect(await obj!.text()).toBe('hello world');
  });

  it('delete removes the object', async () => {
    const d = new R2DefaultDriver(env.R2);
    await d.put('content/del', 'gone');
    await d.delete('content/del');
    expect(await d.get('content/del')).toBeNull();
  });

  it('get returns null for a missing object', async () => {
    const d = new R2DefaultDriver(env.R2);
    expect(await d.get('content/never-put')).toBeNull();
  });
});
