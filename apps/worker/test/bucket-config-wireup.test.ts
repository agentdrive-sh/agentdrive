import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import type { FileMeta, FileVersion, WorkspaceMeta } from '@agentdrive/shared';

// Phase 4 final wire-up — workspaces honor their bucket_config on writes,
// and reads ALWAYS use the locator stamped at write time so a config
// switch can't strand existing files.
//
// We cannot hit a real S3 endpoint from the test pool, but we can prove:
//
//   1. Workspaces can be assigned / cleared a bucket_config via the new
//      routes. Cross-org access is denied.
//   2. After a workspace is assigned an 'agentdrive-r2'-provider config,
//      the FileMeta + FileVersion records carry the new bucket_config_id.
//      (We use an agentdrive-r2-provider config so writes still land in
//      the test pool's R2 binding without needing a mocked customer
//      bucket.)
//   3. THE BIG ONE: a file written under config-A keeps reading
//      correctly after the workspace switches to config-B. The recorded
//      locator on FileMeta is the source of truth, not the workspace's
//      current state.

async function clearKv(): Promise<void> {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

interface RegisterOk { success: true; data: { api_key: string; agent_id: string; org_id: string } }

async function registerAgent(name = 'WireBot', org = 'WireOrg'): Promise<RegisterOk['data']> {
  const res = await SELF.fetch('http://localhost/v1/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_name: name, org_name: org }),
  });
  return ((await res.json()) as RegisterOk).data;
}

function authHeader(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function createWs(key: string, name: string): Promise<string> {
  const res = await SELF.fetch('http://localhost/v1/workspaces', {
    method: 'POST',
    headers: authHeader(key),
    body: JSON.stringify({ name }),
  });
  return ((await res.json()) as { data: { id: string } }).data.id;
}

async function createConfig(key: string, name: string, provider = 'agentdrive-r2'): Promise<string> {
  const body: Record<string, unknown> = { name, provider };
  if (provider !== 'agentdrive-r2') {
    body.endpoint = 'https://s3.us-east-2.amazonaws.com';
    body.region = 'us-east-2';
    body.bucket = 'cust-bucket';
    body.access_key_id = 'AKIATEST';
    body.secret_access_key = 'shh';
  }
  const res = await SELF.fetch('http://localhost/v1/bucket-config', {
    method: 'POST',
    headers: authHeader(key),
    body: JSON.stringify(body),
  });
  return ((await res.json()) as { data: { id: string } }).data.id;
}

async function writeFileTo(key: string, wid: string, path: string, content: string): Promise<{ id: string; bucket_config_id?: string }> {
  const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
    method: 'POST',
    headers: authHeader(key),
    body: JSON.stringify({ path, content }),
  });
  return ((await res.json()) as { data: { id: string; bucket_config_id?: string } }).data;
}

beforeEach(async () => {
  await clearKv();
});

describe('PUT /v1/workspaces/:wid/bucket-config', () => {
  it('returns 401 without auth', async () => {
    const res = await SELF.fetch('http://localhost/v1/workspaces/ws_x/bucket-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket_config_id: 'bcfg_x' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 404 when the workspace does not exist', async () => {
    const a = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/workspaces/ws_nope/bucket-config', {
      method: 'PUT',
      headers: authHeader(a.api_key),
      body: JSON.stringify({ bucket_config_id: 'default' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 when bucket_config_id is not "default" and does not exist', async () => {
    const a = await registerAgent();
    const wid = await createWs(a.api_key, 'A');
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/bucket-config`, {
      method: 'PUT',
      headers: authHeader(a.api_key),
      body: JSON.stringify({ bucket_config_id: 'bcfg_missing' }),
    });
    expect(res.status).toBe(404);
  });

  it('accepts the implicit "default" config without requiring it to exist in KV', async () => {
    const a = await registerAgent();
    const wid = await createWs(a.api_key, 'A');
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/bucket-config`, {
      method: 'PUT',
      headers: authHeader(a.api_key),
      body: JSON.stringify({ bucket_config_id: 'default' }),
    });
    expect(res.status).toBe(200);
  });

  it('updates the workspace and records the assignment in KV', async () => {
    const a = await registerAgent();
    const wid = await createWs(a.api_key, 'A');
    const cfgId = await createConfig(a.api_key, 'managed');

    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/bucket-config`, {
      method: 'PUT',
      headers: authHeader(a.api_key),
      body: JSON.stringify({ bucket_config_id: cfgId }),
    });
    expect(res.status).toBe(200);
    const ws = await env.KV.get<WorkspaceMeta>(`ws:${wid}`, 'json');
    expect(ws!.bucket_config_id).toBe(cfgId);
  });

  it('forbids cross-org assignment', async () => {
    const a = await registerAgent('A', 'OrgA');
    const wid = await createWs(a.api_key, 'A');
    const b = await registerAgent('B', 'OrgB');
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/bucket-config`, {
      method: 'PUT',
      headers: authHeader(b.api_key),
      body: JSON.stringify({ bucket_config_id: 'default' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /v1/workspaces/:wid/bucket-config', () => {
  it('clears the assignment', async () => {
    const a = await registerAgent();
    const wid = await createWs(a.api_key, 'A');
    const cfgId = await createConfig(a.api_key, 'managed');
    await SELF.fetch(`http://localhost/v1/workspaces/${wid}/bucket-config`, {
      method: 'PUT',
      headers: authHeader(a.api_key),
      body: JSON.stringify({ bucket_config_id: cfgId }),
    });

    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/bucket-config`, {
      method: 'DELETE',
      headers: authHeader(a.api_key),
    });
    expect(res.status).toBe(200);
    const ws = await env.KV.get<WorkspaceMeta>(`ws:${wid}`, 'json');
    expect(ws!.bucket_config_id).toBeUndefined();
  });
});

describe('writes honor the workspace bucket_config', () => {
  it('new write stamps the workspace bucket_config_id onto FileMeta + FileVersion', async () => {
    const a = await registerAgent();
    const wid = await createWs(a.api_key, 'Honor');
    const cfgId = await createConfig(a.api_key, 'managed');
    await SELF.fetch(`http://localhost/v1/workspaces/${wid}/bucket-config`, {
      method: 'PUT',
      headers: authHeader(a.api_key),
      body: JSON.stringify({ bucket_config_id: cfgId }),
    });

    const wrote = await writeFileTo(a.api_key, wid, 'honor/one.md', 'one');
    const meta = await env.KV.get<FileMeta>(`file:${wid}:${wrote.id}`, 'json');
    expect(meta).not.toBeNull();
    expect(meta!.bucket_config_id).toBe(cfgId);
    // v1 returns the same provider for the agentdrive-r2 backed config —
    // the storage layer stamps the config_id but uses the default driver.
    expect(meta!.provider).toBe('agentdrive-r2');

    const v1 = await env.KV.get<FileVersion>(`ver:${wrote.id}:000001`, 'json');
    expect(v1).not.toBeNull();
    expect(v1!.bucket_config_id).toBe(cfgId);
  });

  it('refuses to write when the configured bucket is marked degraded', async () => {
    const a = await registerAgent();
    const wid = await createWs(a.api_key, 'Degraded');
    const cfgId = await createConfig(a.api_key, 'managed');
    await SELF.fetch(`http://localhost/v1/workspaces/${wid}/bucket-config`, {
      method: 'PUT',
      headers: authHeader(a.api_key),
      body: JSON.stringify({ bucket_config_id: cfgId }),
    });

    // Manually flip health to degraded to simulate an outage.
    const cfgKey = `bucket_config:${a.org_id}:${cfgId}`;
    const raw = await env.KV.get(cfgKey);
    const cfg = JSON.parse(raw as string) as Record<string, unknown>;
    cfg.health = 'degraded';
    cfg.last_error = 'simulated outage';
    await env.KV.put(cfgKey, JSON.stringify(cfg));

    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: authHeader(a.api_key),
      body: JSON.stringify({ path: 'should-fail.md', content: 'nope' }),
    });
    // The driver factory throws; Hono surfaces it as a 500. The shape is
    // intentional: NO silent fallback to the default bucket per E3.
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});

describe('schema-locator preservation — switching bucket_config does NOT strand old files', () => {
  it('reads of a file written under config-A still work after the workspace switches to config-B', async () => {
    const a = await registerAgent();
    const wid = await createWs(a.api_key, 'PreserveTest');

    // Phase 1: workspace under default config. Write file-A.
    const fileA = await writeFileTo(a.api_key, wid, 'preserve/a.md', 'content-A');
    const metaA = await env.KV.get<FileMeta>(`file:${wid}:${fileA.id}`, 'json');
    expect(metaA!.bucket_config_id).toBe('default');

    // Phase 2: switch the workspace to a different (agentdrive-r2-provider)
    // config and write file-B.
    const cfgB = await createConfig(a.api_key, 'config-B');
    await SELF.fetch(`http://localhost/v1/workspaces/${wid}/bucket-config`, {
      method: 'PUT',
      headers: authHeader(a.api_key),
      body: JSON.stringify({ bucket_config_id: cfgB }),
    });
    const fileB = await writeFileTo(a.api_key, wid, 'preserve/b.md', 'content-B');
    const metaB = await env.KV.get<FileMeta>(`file:${wid}:${fileB.id}`, 'json');
    expect(metaB!.bucket_config_id).toBe(cfgB);

    // CONTRACT: reading file-A still returns the original content even
    // though the workspace's current bucket_config has changed. The
    // locator on metaA is the source of truth.
    const readA = await SELF.fetch(
      `http://localhost/v1/workspaces/${wid}/files/${fileA.id}?content=true`,
      { headers: authHeader(a.api_key) },
    );
    const bodyA = (await readA.json()) as { data: { content: string } };
    expect(bodyA.data.content).toBe('content-A');

    // And reading file-B (written under config-B) returns its content too.
    const readB = await SELF.fetch(
      `http://localhost/v1/workspaces/${wid}/files/${fileB.id}?content=true`,
      { headers: authHeader(a.api_key) },
    );
    const bodyB = (await readB.json()) as { data: { content: string } };
    expect(bodyB.data.content).toBe('content-B');
  });

  it('switching back to default keeps the locator on intermediate-config files intact', async () => {
    const a = await registerAgent();
    const wid = await createWs(a.api_key, 'BackForth');
    const cfgId = await createConfig(a.api_key, 'custom');

    await SELF.fetch(`http://localhost/v1/workspaces/${wid}/bucket-config`, {
      method: 'PUT',
      headers: authHeader(a.api_key),
      body: JSON.stringify({ bucket_config_id: cfgId }),
    });
    const fileUnderCustom = await writeFileTo(a.api_key, wid, 'middle.md', 'middle');

    // Switch back to default.
    await SELF.fetch(`http://localhost/v1/workspaces/${wid}/bucket-config`, {
      method: 'DELETE',
      headers: authHeader(a.api_key),
    });

    const meta = await env.KV.get<FileMeta>(`file:${wid}:${fileUnderCustom.id}`, 'json');
    // The recorded locator still references the custom config, even
    // though the workspace itself is back to default.
    expect(meta!.bucket_config_id).toBe(cfgId);

    // And reads still work.
    const read = await SELF.fetch(
      `http://localhost/v1/workspaces/${wid}/files/${fileUnderCustom.id}?content=true`,
      { headers: authHeader(a.api_key) },
    );
    const body = (await read.json()) as { data: { content: string } };
    expect(body.data.content).toBe('middle');
  });
});
