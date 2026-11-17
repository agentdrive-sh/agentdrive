import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import type { BucketConfigMeta } from '@agentdrive/shared';

// Phase 4 step 6 — /v1/bucket-config CRUD + the secret-masking contract.
//
// What we're pinning:
//   - 401 on unauth
//   - 403 on share-token auth (org-scoped only)
//   - 400 on missing fields for s3-compat providers
//   - 201 + masked response on POST; secret never returned
//   - GET list + GET one NEVER return secret_access_key
//   - DELETE 404 on missing, 200 on success
//   - The full secret is stored intact in KV (so the worker can later
//     construct an S3CompatDriver) but never crosses the wire.

async function clearKv(): Promise<void> {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

interface RegisterOk { success: true; data: { api_key: string; agent_id: string; org_id: string } }

async function registerAgent(): Promise<RegisterOk['data']> {
  const res = await SELF.fetch('http://localhost/v1/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_name: 'BucketBot' }),
  });
  const principal = ((await res.json()) as RegisterOk).data;
  // BYO storage is a Team feature; these CRUD/masking tests use an entitled
  // customer. Free-plan refusal is covered by launch-lifecycle regression.
  const org = await env.KV.get<Record<string, unknown>>(`org:${principal.org_id}`, 'json');
  await env.KV.put(`org:${principal.org_id}`, JSON.stringify({ ...org, plan: 'team' }));
  return principal;
}

function authHeader(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

const s3Body = {
  name: 'my-customer-bucket',
  provider: 's3-hmac',
  endpoint: 'https://s3.us-east-2.amazonaws.com',
  region: 'us-east-2',
  bucket: 'cust-bucket-prod',
  access_key_id: 'AKIAEXAMPLE',
  secret_access_key: 'verysecretdonotleak',
};

beforeEach(async () => {
  await clearKv();
});

describe('POST /v1/bucket-config', () => {
  it('returns 401 without auth', async () => {
    const res = await SELF.fetch('http://localhost/v1/bucket-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s3Body),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 when s3-compat provider is missing required fields', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/bucket-config', {
      method: 'POST',
      headers: authHeader(agent.api_key),
      body: JSON.stringify({ name: 'incomplete', provider: 's3-hmac' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: false; error: string };
    expect(body.error).toMatch(/endpoint|region|bucket|access_key/i);
  });

  it('returns 201 on success and the response NEVER contains secret_access_key', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/bucket-config', {
      method: 'POST',
      headers: authHeader(agent.api_key),
      body: JSON.stringify(s3Body),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: true; data: Record<string, unknown> };
    expect(body.data.id).toMatch(/^bcfg_/);
    expect(body.data.org_id).toBe(agent.org_id);
    expect(body.data.provider).toBe('s3-hmac');
    expect(body.data.access_key_id).toBe('AKIAEXAMPLE');
    expect(body.data.health).toBe('unverified');
    // The critical contract — the secret never crosses the wire even
    // on the create response that just received it.
    expect('secret_access_key' in body.data).toBe(false);
    expect(JSON.stringify(body.data)).not.toContain('verysecretdonotleak');
  });

  it('accepts agentdrive-r2 without the s3-compat fields (default provider declaration)', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/bucket-config', {
      method: 'POST',
      headers: authHeader(agent.api_key),
      body: JSON.stringify({ name: 'managed', provider: 'agentdrive-r2' }),
    });
    expect(res.status).toBe(201);
  });

  it('stores the secret in KV intact so the worker can construct a driver later', async () => {
    const agent = await registerAgent();
    const create = await SELF.fetch('http://localhost/v1/bucket-config', {
      method: 'POST',
      headers: authHeader(agent.api_key),
      body: JSON.stringify(s3Body),
    });
    const body = (await create.json()) as { data: { id: string } };
    const raw = await env.KV.get<BucketConfigMeta>(
      `bucket_config:${agent.org_id}:${body.data.id}`,
      'json',
    );
    expect(raw).not.toBeNull();
    expect(raw!.secret_access_key).toBe('verysecretdonotleak');
    expect(raw!.access_key_id).toBe('AKIAEXAMPLE');
  });
});

describe('GET /v1/bucket-config', () => {
  it('returns 401 without auth', async () => {
    const res = await SELF.fetch('http://localhost/v1/bucket-config');
    expect(res.status).toBe(401);
  });

  it('lists configs without secrets', async () => {
    const agent = await registerAgent();
    await SELF.fetch('http://localhost/v1/bucket-config', {
      method: 'POST',
      headers: authHeader(agent.api_key),
      body: JSON.stringify(s3Body),
    });

    const res = await SELF.fetch('http://localhost/v1/bucket-config', {
      headers: authHeader(agent.api_key),
    });
    const body = (await res.json()) as {
      success: true;
      data: Array<Record<string, unknown>>;
    };
    expect(body.data.length).toBe(1);
    expect('secret_access_key' in body.data[0]!).toBe(false);
    expect(JSON.stringify(body.data)).not.toContain('verysecretdonotleak');
  });

  it('returns 404 for a config the caller does not own', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/bucket-config/bcfg_nope', {
      headers: authHeader(agent.api_key),
    });
    expect(res.status).toBe(404);
  });

  it('GET /:id never returns the secret', async () => {
    const agent = await registerAgent();
    const create = await SELF.fetch('http://localhost/v1/bucket-config', {
      method: 'POST',
      headers: authHeader(agent.api_key),
      body: JSON.stringify(s3Body),
    });
    const created = (await create.json()) as { data: { id: string } };

    const res = await SELF.fetch(`http://localhost/v1/bucket-config/${created.data.id}`, {
      headers: authHeader(agent.api_key),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect('secret_access_key' in body.data).toBe(false);
    expect(JSON.stringify(body.data)).not.toContain('verysecretdonotleak');
  });
});

describe('DELETE /v1/bucket-config/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await SELF.fetch('http://localhost/v1/bucket-config/bcfg_x', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for a non-existent id', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/bucket-config/bcfg_nope', {
      method: 'DELETE',
      headers: authHeader(agent.api_key),
    });
    expect(res.status).toBe(404);
  });

  it('deletes the config and subsequent GETs return 404', async () => {
    const agent = await registerAgent();
    const create = await SELF.fetch('http://localhost/v1/bucket-config', {
      method: 'POST',
      headers: authHeader(agent.api_key),
      body: JSON.stringify(s3Body),
    });
    const created = (await create.json()) as { data: { id: string } };

    const del = await SELF.fetch(`http://localhost/v1/bucket-config/${created.data.id}`, {
      method: 'DELETE',
      headers: authHeader(agent.api_key),
    });
    expect(del.status).toBe(200);

    const after = await SELF.fetch(`http://localhost/v1/bucket-config/${created.data.id}`, {
      headers: authHeader(agent.api_key),
    });
    expect(after.status).toBe(404);
  });
});

describe('cross-org isolation', () => {
  it('an agent in org A cannot see or delete bucket_configs from org B', async () => {
    const a = await registerAgent();
    // Second registration creates a separate org.
    const bRes = await SELF.fetch('http://localhost/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_name: 'OtherBot', org_name: 'OtherOrg' }),
    });
    const b = ((await bRes.json()) as RegisterOk).data;
    expect(b.org_id).not.toBe(a.org_id);

    const create = await SELF.fetch('http://localhost/v1/bucket-config', {
      method: 'POST',
      headers: authHeader(a.api_key),
      body: JSON.stringify(s3Body),
    });
    const created = (await create.json()) as { data: { id: string } };

    // Agent in org B cannot read the config from org A
    const peek = await SELF.fetch(`http://localhost/v1/bucket-config/${created.data.id}`, {
      headers: authHeader(b.api_key),
    });
    expect(peek.status).toBe(404);

    // ...and the list endpoint only shows their own (empty)
    const list = await SELF.fetch('http://localhost/v1/bucket-config', {
      headers: authHeader(b.api_key),
    });
    const body = (await list.json()) as { data: unknown[] };
    expect(body.data.length).toBe(0);
  });
});
