import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, AuthContext } from '../env.js';
import { flexAuth } from '../middleware/auth.js';
import { BucketConfigStore } from '../services/bucket-config.js';
import { R2DefaultDriver } from '../services/bucket-driver/r2-default.js';
import { S3CompatDriver } from '../services/bucket-driver/s3-compat.js';
import type { BucketDriver } from '../services/bucket-driver/types.js';
import { canManageOrg, storage } from '../lib/route-helpers.js';
import { selfHosted } from '../lib/self-hosted.js';

// /v1/bucket-config — owner/admin writes, mask-secrets reads.
//
// Mount at /v1/bucket-config. The route is gated to agent + session
// principals with an org_id; share tokens are explicitly rejected.
// Per CEO plan: GET endpoints NEVER return secret_access_key — the store
// runs through maskBucketConfig() so a misuse can't accidentally leak.

type Variables = { auth: AuthContext };
type AppType = { Bindings: Env; Variables: Variables };

const app = new Hono<AppType>();
app.use('*', flexAuth);

const providerSchema = z.enum(['agentdrive-r2', 'cf-r2-cross-account', 's3-hmac']);

const createSchema = z
  .object({
    name: z.string().min(1).max(120),
    provider: providerSchema,
    endpoint: z.string().url().optional(),
    region: z.string().min(1).max(64).optional(),
    bucket: z.string().min(1).max(120).optional(),
    access_key_id: z.string().min(1).max(256).optional(),
    secret_access_key: z.string().min(1).max(1024).optional(),
  })
  .refine(
    (v) => {
      if (v.provider === 'agentdrive-r2') return true;
      return Boolean(v.endpoint && v.region && v.bucket && v.access_key_id && v.secret_access_key);
    },
    {
      message:
        's3-compat providers (cf-r2-cross-account, s3-hmac) require endpoint + region + bucket + access_key_id + secret_access_key',
    },
  );

function resolveOrgAndPrincipal(auth: AuthContext): { orgId: string; principalId: string } | null {
  if (auth.type === 'agent' && auth.org_id) {
    return { orgId: auth.org_id, principalId: auth.agent_id };
  }
  if (auth.type === 'session' && auth.org_id) {
    return { orgId: auth.org_id, principalId: auth.email };
  }
  return null;
}

app.post('/', async (c) => {
  const auth = c.get('auth');
  const principal = resolveOrgAndPrincipal(auth);
  if (!principal) {
    return c.json(
      { success: false, error: 'bucket_config writes require an agent or session with an org' },
      403,
    );
  }

  if (!(await canManageOrg(storage(c), auth, principal.orgId))) {
    return c.json({ success: false, error: 'Only an org owner or admin can manage storage configurations' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message ?? 'invalid body' }, 400);
  }
  if (parsed.data.provider !== 'agentdrive-r2' && !selfHosted(c.env) && (await storage(c).getOrg(principal.orgId))?.plan !== 'team') {
    return c.json({ success: false, code: 'plan_required', error: 'Bring your own bucket requires Team', required_plan: 'team' }, 403);
  }

  const store = new BucketConfigStore(c.env.KV);
  const created = await store.create({
    org_id: principal.orgId,
    name: parsed.data.name,
    provider: parsed.data.provider,
    endpoint: parsed.data.endpoint,
    region: parsed.data.region,
    bucket: parsed.data.bucket,
    access_key_id: parsed.data.access_key_id,
    secret_access_key: parsed.data.secret_access_key,
    created_by: principal.principalId,
  });

  // Strip secret_access_key from the response. Owner sees the id + masked
  // metadata; they keep the secret in their own vault / Cloudflare secrets.
  const { secret_access_key: _hidden, ...safe } = created;
  return c.json({ success: true, data: safe }, 201);
});

app.get('/', async (c) => {
  const auth = c.get('auth');
  const principal = resolveOrgAndPrincipal(auth);
  if (!principal) {
    return c.json({ success: false, error: 'bucket_config reads require an org-scoped principal' }, 403);
  }
  const cursor = c.req.query('cursor');
  const store = new BucketConfigStore(c.env.KV);
  const page = await store.list(principal.orgId, cursor);
  return c.json({ success: true, data: page.items, cursor: page.cursor });
});

app.get('/:id', async (c) => {
  const auth = c.get('auth');
  const principal = resolveOrgAndPrincipal(auth);
  if (!principal) {
    return c.json({ success: false, error: 'bucket_config reads require an org-scoped principal' }, 403);
  }
  const id = c.req.param('id')!;
  const store = new BucketConfigStore(c.env.KV);
  const meta = await store.get(principal.orgId, id);
  if (!meta) {
    return c.json({ success: false, error: 'bucket_config not found' }, 404);
  }
  const { secret_access_key: _hidden, ...safe } = meta;
  return c.json({ success: true, data: safe });
});

// POST /v1/bucket-config/:id/verify — owner/admin credential check.
//
// Runs a real write+read+delete against the configured bucket using the
// driver this config would produce. On success, flips health to 'healthy'
// and stamps last_verified_at. On failure, flips to 'degraded' with the
// error message so future writes refuse at the resolveDriverForWrite gate.
//
// This is also the recovery path: an owner whose credentials lapsed can
// fix them, re-run verify, and have the bucket back online without
// touching anything else. (Writes ALSO auto-recover on first success per
// storage.writeFile — verify just gives the owner a manual button.)
app.post('/:id/verify', async (c) => {
  const auth = c.get('auth');
  const principal = resolveOrgAndPrincipal(auth);
  if (!principal) {
    return c.json({ success: false, error: 'bucket_config writes require an org-scoped principal' }, 403);
  }
  if (!(await canManageOrg(storage(c), auth, principal.orgId))) {
    return c.json({ success: false, error: 'Only an org owner or admin can manage storage configurations' }, 403);
  }
  const id = c.req.param('id')!;
  const store = new BucketConfigStore(c.env.KV);
  const meta = await store.get(principal.orgId, id);
  if (!meta) {
    return c.json({ success: false, error: 'bucket_config not found' }, 404);
  }

  // Build a driver from the stored config.
  let driver: BucketDriver;
  try {
    if (meta.provider === 'agentdrive-r2') {
      driver = new R2DefaultDriver(c.env.R2);
    } else {
      if (!meta.endpoint || !meta.region || !meta.bucket || !meta.access_key_id || !meta.secret_access_key) {
        throw new Error('bucket_config is missing required s3-compat fields');
      }
      driver = new S3CompatDriver({
        provider: meta.provider,
        bucketConfigId: meta.id,
        endpoint: meta.endpoint,
        region: meta.region,
        bucket: meta.bucket,
        accessKeyId: meta.access_key_id,
        secretAccessKey: meta.secret_access_key,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await store.markHealth(principal.orgId, id, 'degraded', msg);
    return c.json({ success: false, error: msg, data: { health: 'degraded' } }, 502);
  }

  // Probe key under a path that won't collide with real content. Random
  // suffix + timestamp so re-running the verify never reuses the same key.
  const probeKey = `_verify/${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const probeBody = `agentdrive verify probe ${new Date().toISOString()}`;
  try {
    await driver.put(probeKey, probeBody, { contentType: 'text/plain' });
    const obj = await driver.get(probeKey);
    if (!obj) {
      throw new Error('verify probe written but immediately not found (read-your-write inconsistency)');
    }
    const got = await obj.text();
    if (got !== probeBody) {
      throw new Error(`verify probe content mismatch: wrote ${probeBody.length} bytes, got ${got.length}`);
    }
    await driver.delete(probeKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await store.markHealth(principal.orgId, id, 'degraded', msg);
    return c.json({ success: false, error: msg, data: { health: 'degraded' } }, 502);
  }

  const updated = await store.markHealth(principal.orgId, id, 'healthy');
  const { secret_access_key: _hidden, ...safe } = updated!;
  return c.json({ success: true, data: safe });
});

app.delete('/:id', async (c) => {
  const auth = c.get('auth');
  const principal = resolveOrgAndPrincipal(auth);
  if (!principal) {
    return c.json({ success: false, error: 'bucket_config writes require an org-scoped principal' }, 403);
  }
  if (!(await canManageOrg(storage(c), auth, principal.orgId))) {
    return c.json({ success: false, error: 'Only an org owner or admin can manage storage configurations' }, 403);
  }
  const id = c.req.param('id')!;
  const store = new BucketConfigStore(c.env.KV);
  if (!(await store.get(principal.orgId, id))) {
    return c.json({ success: false, error: 'bucket_config not found' }, 404);
  }
  let cursor: string | undefined;
  do {
    const page = await storage(c).listWorkspaces(principal.orgId, cursor);
    if (page.items.some((workspace) => workspace.bucket_config_id === id)) {
      return c.json({ success: false, error: 'Detach this storage configuration from its workspaces before deleting it' }, 409);
    }
    cursor = page.cursor ?? undefined;
  } while (cursor);
  const deleted = await store.delete(principal.orgId, id);
  if (!deleted) {
    return c.json({ success: false, error: 'bucket_config not found' }, 404);
  }
  return c.json({ success: true, data: { deleted: true } });
});

export default app;
