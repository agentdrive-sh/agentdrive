import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { S3CompatDriver, type S3DriverConfig } from '../src/services/bucket-driver/s3-compat.js';
import { getBucketDriver, R2DefaultDriver } from '../src/services/bucket-driver/index.js';

// Phase 4 step 5 — cross-account R2 + S3 HMAC drivers.
//
// We cannot hit a real S3 endpoint from the vitest pool, so these tests
// stub global `fetch` to:
//   - capture the signed request URL + method + headers
//   - return canned responses for HEAD / GET / PUT / DELETE
//
// What we're pinning:
//   - URL construction (path-style: <endpoint>/<bucket>/<key>)
//   - Method per operation
//   - SigV4 Authorization header is attached (aws4fetch did the work)
//   - 404 paths return null for head + get
//   - non-404 errors throw (fail-closed per E3)
//   - Factory dispatch by provider + config-mismatch detection

const baseConfig = (overrides: Partial<S3DriverConfig> = {}): S3DriverConfig => ({
  provider: 's3-hmac',
  bucketConfigId: 'cfg_test',
  endpoint: 'https://s3.us-east-2.amazonaws.com',
  region: 'us-east-2',
  bucket: 'agentdrive-test',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secretkeyexample123',
  ...overrides,
});

interface FetchCall {
  url: string;
  method: string;
  authPresent: boolean;
  body?: BodyInit | null;
}

const calls: FetchCall[] = [];
let fetchImpl: (req: Request) => Response | Promise<Response>;

beforeEach(() => {
  calls.length = 0;
  fetchImpl = () => new Response('', { status: 200 });
  vi.stubGlobal('fetch', (...args: Parameters<typeof fetch>) => {
    const req = args[0] instanceof Request ? args[0] : new Request(...args);
    calls.push({
      url: req.url,
      method: req.method,
      authPresent: req.headers.has('authorization'),
      body: undefined,
    });
    return fetchImpl(req);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('S3CompatDriver URL construction', () => {
  it('uses path-style <endpoint>/<bucket>/<key>', async () => {
    const driver = new S3CompatDriver(baseConfig());
    await driver.head('content/abc');
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe('https://s3.us-east-2.amazonaws.com/agentdrive-test/content/abc');
    expect(calls[0]!.method).toBe('HEAD');
  });

  it('encodes unusual characters per segment but preserves slashes', async () => {
    const driver = new S3CompatDriver(baseConfig());
    await driver.get('content/has space/file.md');
    expect(calls[0]!.url).toBe(
      'https://s3.us-east-2.amazonaws.com/agentdrive-test/content/has%20space/file.md',
    );
  });
});

describe('S3CompatDriver SigV4 signing', () => {
  it('attaches an Authorization header on every request', async () => {
    const driver = new S3CompatDriver(baseConfig());
    await driver.head('x');
    await driver.get('y');
    await driver.put('z', 'hi');
    await driver.delete('a');
    expect(calls.length).toBe(4);
    for (const c of calls) expect(c.authPresent).toBe(true);
  });
});

describe('S3CompatDriver head', () => {
  it('returns null on 404', async () => {
    fetchImpl = () => new Response('', { status: 404 });
    const driver = new S3CompatDriver(baseConfig());
    expect(await driver.head('missing')).toBeNull();
  });

  it('returns size from Content-Length on 200', async () => {
    fetchImpl = () =>
      new Response('', { status: 200, headers: { 'content-length': '42' } });
    const driver = new S3CompatDriver(baseConfig());
    const r = await driver.head('exists');
    expect(r).toEqual({ size: 42 });
  });

  it('throws on 500 (fail-closed)', async () => {
    fetchImpl = () => new Response('boom', { status: 500, statusText: 'Internal' });
    const driver = new S3CompatDriver(baseConfig());
    await expect(driver.head('x')).rejects.toThrow(/S3 HEAD s3-hmac: 500/);
  });

  it('throws on 403 (fail-closed; never falls back to default bucket)', async () => {
    fetchImpl = () => new Response('forbidden', { status: 403, statusText: 'Forbidden' });
    const driver = new S3CompatDriver(baseConfig());
    await expect(driver.head('x')).rejects.toThrow(/S3 HEAD s3-hmac: 403/);
  });
});

describe('S3CompatDriver get', () => {
  it('returns null on 404', async () => {
    fetchImpl = () => new Response('', { status: 404 });
    const driver = new S3CompatDriver(baseConfig());
    expect(await driver.get('missing')).toBeNull();
  });

  it('exposes text() and arrayBuffer() on success', async () => {
    fetchImpl = () => new Response('hello world', { status: 200 });
    const driver = new S3CompatDriver(baseConfig());
    const obj = await driver.get('a');
    expect(obj).not.toBeNull();
    expect(await obj!.text()).toBe('hello world');
    const ab = await obj!.arrayBuffer();
    expect(new TextDecoder().decode(ab)).toBe('hello world');
  });

  it('throws on auth failure', async () => {
    fetchImpl = () => new Response('', { status: 401, statusText: 'Unauthorized' });
    const driver = new S3CompatDriver(baseConfig());
    await expect(driver.get('a')).rejects.toThrow(/S3 GET s3-hmac: 401/);
  });
});

describe('S3CompatDriver put', () => {
  it('sends PUT with body', async () => {
    const driver = new S3CompatDriver(baseConfig());
    await driver.put('content/abc', 'payload', { contentType: 'text/markdown' });
    expect(calls[0]!.method).toBe('PUT');
  });

  it('throws on non-2xx', async () => {
    fetchImpl = () => new Response('quota', { status: 507, statusText: 'Insufficient' });
    const driver = new S3CompatDriver(baseConfig());
    await expect(driver.put('content/a', 'x')).rejects.toThrow(/S3 PUT s3-hmac: 507/);
  });
});

describe('S3CompatDriver delete', () => {
  it('issues DELETE', async () => {
    const driver = new S3CompatDriver(baseConfig());
    await driver.delete('content/abc');
    expect(calls[0]!.method).toBe('DELETE');
  });

  it('treats 404 as idempotent success (no throw)', async () => {
    fetchImpl = () => new Response('', { status: 404 });
    const driver = new S3CompatDriver(baseConfig());
    await expect(driver.delete('nope')).resolves.toBeUndefined();
  });

  it('throws on 500', async () => {
    fetchImpl = () => new Response('', { status: 500, statusText: 'Internal' });
    const driver = new S3CompatDriver(baseConfig());
    await expect(driver.delete('a')).rejects.toThrow(/S3 DELETE s3-hmac: 500/);
  });
});

describe('S3CompatDriver provider tagging', () => {
  it('reports cf-r2-cross-account when configured as such', () => {
    const driver = new S3CompatDriver(baseConfig({ provider: 'cf-r2-cross-account' }));
    expect(driver.provider).toBe('cf-r2-cross-account');
    expect(driver.bucketConfigId).toBe('cfg_test');
  });

  it('reports s3-hmac by default', () => {
    const driver = new S3CompatDriver(baseConfig());
    expect(driver.provider).toBe('s3-hmac');
  });
});

describe('getBucketDriver factory dispatch', () => {
  it('returns R2DefaultDriver for legacy / agentdrive-r2 locator', () => {
    expect(getBucketDriver(env, undefined)).toBeInstanceOf(R2DefaultDriver);
    expect(getBucketDriver(env, { provider: 'agentdrive-r2' })).toBeInstanceOf(R2DefaultDriver);
  });

  it('returns S3CompatDriver for cf-r2-cross-account when s3 config is supplied', () => {
    const driver = getBucketDriver(
      env,
      { provider: 'cf-r2-cross-account', bucket_config_id: 'cfg_a' },
      { s3: baseConfig({ provider: 'cf-r2-cross-account' }) },
    );
    expect(driver).toBeInstanceOf(S3CompatDriver);
    expect(driver.provider).toBe('cf-r2-cross-account');
  });

  it('returns S3CompatDriver for s3-hmac when s3 config is supplied', () => {
    const driver = getBucketDriver(
      env,
      { provider: 's3-hmac', bucket_config_id: 'cfg_b' },
      { s3: baseConfig({ provider: 's3-hmac' }) },
    );
    expect(driver).toBeInstanceOf(S3CompatDriver);
    expect(driver.provider).toBe('s3-hmac');
  });

  it('throws when locator says cf-r2-cross-account but no s3 config is supplied', () => {
    expect(() =>
      getBucketDriver(env, { provider: 'cf-r2-cross-account', bucket_config_id: 'cfg_c' }),
    ).toThrow(/requires an s3 config/);
  });

  it('throws on locator/config provider mismatch', () => {
    expect(() =>
      getBucketDriver(
        env,
        { provider: 's3-hmac', bucket_config_id: 'cfg_d' },
        { s3: baseConfig({ provider: 'cf-r2-cross-account' }) },
      ),
    ).toThrow(/provider mismatch/);
  });
});
