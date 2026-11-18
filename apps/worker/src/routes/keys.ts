import { Hono } from 'hono';
import { z } from 'zod';
import { generateId, hashApiKey } from '@agentdrive/shared';
import type { Env, AuthContext } from '../env.js';
import { flexAuth } from '../middleware/auth.js';
import { storage, callerIsOwner } from '../lib/route-helpers.js';
import { planLimitError, planLimitFor } from '../services/limits.js';

// /v1/keys — list, mint, and revoke API keys for the caller's org.
//
// Each key is its own agent principal (matches /v1/register: one key = one
// principal, distinguished in provenance by the X-Agent-Platform header).
// The secret is returned exactly once, at creation. GET never returns it.
// Gated to agent + session principals with an org_id; share tokens rejected.

type Variables = { auth: AuthContext };
type AppType = { Bindings: Env; Variables: Variables };

const app = new Hono<AppType>();
app.use('*', flexAuth);

function resolveOrg(auth: AuthContext): string | null {
  if (auth.type === 'agent' && auth.org_id) return auth.org_id;
  if (auth.type === 'session' && auth.org_id) return auth.org_id;
  return null;
}

export const createKeySchema = z.object({ name: z.string().min(1).max(100) });

const FORBIDDEN = { success: false, error: 'API key management requires an org-scoped principal' } as const;

app.get('/', async (c) => {
  const orgId = resolveOrg(c.get('auth'));
  if (!orgId) return c.json(FORBIDDEN, 403);
  const page = await storage(c).listApiKeys(orgId, c.req.query('cursor'));
  return c.json({ success: true, data: page.items, cursor: page.cursor });
});

app.post('/', async (c) => {
  const auth = c.get('auth');
  const orgId = resolveOrg(auth);
  if (!orgId) return c.json(FORBIDDEN, 403);
  const createdBy = auth.type === 'session' ? auth.email.toLowerCase() : auth.type === 'agent' ? auth.created_by : undefined;

  const body = await c.req.json().catch(() => null);
  const parsed = createKeySchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: 'name is required (1-100 chars)' }, 400);

  const refusal = await planLimitFor(c.env, orgId, 'agent_count');
  if (refusal) return planLimitError(c, refusal);

  const s = storage(c);
  const agentId = generateId('ag');
  const apiKey = `agentdrive_live_${generateId()}${generateId()}`;
  const keyHash = await hashApiKey(apiKey);
  const prefix = `${apiKey.slice(0, 22)}…${apiKey.slice(-4)}`;

  const record = await s.createApiKey(orgId, agentId, parsed.data.name, keyHash, prefix, createdBy, auth.type === 'agent' ? auth.agent_id : undefined);
  await s.addOrgAgent(orgId, agentId, parsed.data.name);
  await s.incrementUsage(orgId, 'agent_count', 1);

  // api_key is returned ONCE — the client must capture it now.
  return c.json({ success: true, data: { ...record, api_key: apiKey } }, 201);
});

// Revoking a key also ends the share links and role grants it issued, so a key is
// revocable by its holder, the key that created it, its member's sessions and owners.
// An org made by /v1/register has no human owner, so its founding agent may revoke any
// key no member holds; otherwise a stolen key could mint a backup no one can revoke.
app.delete('/:key_id', async (c) => {
  const auth = c.get('auth');
  const orgId = resolveOrg(auth);
  if (!orgId) return c.json(FORBIDDEN, 403);
  const keyId = c.req.param('key_id');
  const s = storage(c);
  const key = await s.getApiKey(orgId, keyId);
  if (!key) return c.json({ success: false, error: 'key not found' }, 404);
  const allowed = auth.type === 'agent'
    ? key.agent_id === auth.agent_id || key.minted_by === auth.agent_id
      || (!key.created_by && (await s.getOrg(orgId))?.created_by === auth.agent_id)
    : auth.type === 'session'
      && (key.created_by === auth.email.toLowerCase() || (await callerIsOwner(s, auth, orgId)));
  if (!allowed) {
    const error = auth.type === 'agent'
      ? 'An API key can revoke itself and keys it created: ask an org owner to revoke other keys'
      : 'Only an org owner can revoke a key you did not create';
    return c.json({ success: false, error }, 403);
  }
  await s.revokeApiKey(orgId, keyId);
  return c.json({ success: true, data: { revoked: true } });
});

export default app;
