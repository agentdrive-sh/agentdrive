import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, AuthContext } from '../env.js';
import { flexAuth } from '../middleware/auth.js';
import { ipRateLimit } from '../middleware/rate-limit.js';
import { selfHosted } from '../lib/self-hosted.js';
import { createPending, createPendingId, getPending, completePending, checkUserCode, pollPending, CLI_PENDING_TTL, MAX_CODE_ATTEMPTS } from '../services/cli-pending.js';
import { StorageService } from '../services/storage.js';
import { planLimitError, planLimitFor, type PlanLimitBody } from '../services/limits.js';
import { generateId, hashApiKey, type CliPendingRecord } from '@agentdrive/shared';

type Variables = { auth: AuthContext };
type AppType = { Bindings: Env; Variables: Variables };

const app = new Hono<AppType>();

const START_AGAIN = 'Start sign-in again from your terminal.';
const EXPIRED = { success: false, code: 'expired', error: `This sign-in has expired or was already used. ${START_AGAIN}` } as const;

// A client that never shows the user code starts logins nobody can authorize, so it is
// told to update rather than left waiting out the timeout.
app.post('/start', ipRateLimit('ip_magic'), async (c) => {
  // A self-hosted instance has no dashboard or email sign-in, so a browser login could never finish.
  if (selfHosted(c.env)) {
    return c.json({
      success: false,
      code: 'cli_browser_signin_disabled',
      error: 'Browser sign-in is not available on this self-hosted instance. Get an API key from its operator and pipe it to `adrive auth login --with-key`.',
    }, 501);
  }
  const body = await c.req.json().catch(() => null);
  if (!z.object({ shows_user_code: z.literal(true) }).safeParse(body).success) {
    return c.json({
      success: false,
      code: 'cli_outdated',
      error: 'This version of the AgentDrive CLI can no longer sign in. Update it with `npm i -g @adrive/cli@latest`, then sign in again.',
    }, 400);
  }
  const id = createPendingId();
  const { userCode, deviceCode } = await createPending(c.env, id);
  const base = c.env.SITE_URL.replace(/\/$/, '');
  return c.json({
    success: true,
    data: {
      id,
      auth_url: `${base}/cli-auth?id=${encodeURIComponent(id)}`,
      user_code: userCode,
      device_code: deviceCode,
      expires_in: CLI_PENDING_TTL,
    },
  }, 201);
});

app.post('/poll', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ id: z.string().min(1), device_code: z.string().min(1) }).safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: 'id and device_code are required' }, 400);

  const record = await pollPending(c.env, parsed.data.id, parsed.data.device_code);
  if (!record || record.status === 'expired') {
    return c.json({ success: true, data: { status: 'expired' } });
  }
  if (record.status === 'pending') {
    return c.json({ success: true, data: { status: 'pending' } });
  }
  if (record.status === 'denied') {
    return c.json({ success: true, data: { status: 'denied', error: 'Sign-in was cancelled after too many wrong codes were entered.' } });
  }
  if (record.status === 'refused') {
    return c.json({ success: true, data: { status: 'refused', error: record.error, upgrade_url: record.upgrade_url } });
  }
  return c.json({
    success: true,
    data: {
      status: 'complete',
      agent_id: record.agent_id,
      org_id: record.org_id,
      email: record.email,
      api_key: record.api_key,
    },
  });
});

// Its own count, so mistyped codes end in `denied` rather than spending the IP's sign-in budget.
app.post('/complete', ipRateLimit('ip_magic', 'cli_complete'), flexAuth, async (c) => {
  const auth = c.get('auth');
  if (auth.type !== 'session') {
    return c.json({ success: false, error: 'Session auth required' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({
    id: z.string().min(1),
    user_code: z.string().trim().min(1).max(32),
    agent_name: z.string().min(1).max(100).optional(),
  }).safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, code: 'user_code_required', error: 'Enter the code shown in your terminal.' }, 400);
  }

  const pending = await getPending(c.env, parsed.data.id);
  if (!pending || pending.status !== 'pending') {
    return c.json(EXPIRED, 404);
  }
  const check = await checkUserCode(c.env, pending, parsed.data.user_code);
  if (check === 'denied') {
    return c.json({ success: false, code: 'denied', error: `Too many wrong codes, so this sign-in was cancelled. ${START_AGAIN}` }, 403);
  }
  if (check === 'wrong') {
    const left = MAX_CODE_ATTEMPTS - pending.failed_attempts - 1;
    return c.json({ success: false, code: 'wrong_code', error: `That code does not match the one in your terminal. ${left} ${left === 1 ? 'try' : 'tries'} left.` }, 400);
  }

  const record = await completeCliPending(c.env, parsed.data.id, {
    email: auth.email,
    org_id: auth.org_id,
    agentName: parsed.data.agent_name,
  });

  if (!record) return c.json(EXPIRED, 404);
  if ('code' in record) return planLimitError(c, record);
  return c.json({ success: true, data: { status: record.status } });
});

export interface CliCompleteOptions {
  email: string;
  org_id?: string;
  agentName?: string;
}

// The CLI and hosted-MCP OAuth grants authenticate with an API key only, so each mints one.
// It goes through the managed-key path so it shows up in /v1/keys and can be revoked.
// At the agent cap it mints nothing and returns the refusal, with the upgrade link.
// `freeing` counts keys the caller revokes once this one is in use, so a reconnect at
// the cap can replace its own key.
export async function mintAgentKey(
  env: Env,
  opts: { email: string; orgId?: string; name: string; freeing?: number; oauthClientId?: string },
): Promise<{ orgId: string; agentId: string; apiKey: string; keyId: string } | PlanLimitBody> {
  const storage = new StorageService(env.KV, env.R2);
  const orgId = opts.orgId ?? (await storage.getOrCreateOrgForEmail(opts.email, env));
  const refusal = await planLimitFor(env, orgId, 'agent_count');
  // shortcut: racing mints (consents, CLI logins) can exceed the cap by the number in flight;
  // serialize per org through a Durable Object if that ever matters.
  if (refusal && refusal.used - (opts.freeing ?? 0) >= refusal.limit) return refusal;
  const agentId = generateId('ag');
  const apiKey = `agentdrive_live_${generateId()}${generateId()}`;
  const { key_id: keyId } = await storage.createApiKey(
    orgId, agentId, opts.name, await hashApiKey(apiKey), `${apiKey.slice(0, 22)}…${apiKey.slice(-4)}`, opts.email.toLowerCase(), undefined, opts.oauthClientId,
  );
  await storage.addOrgAgent(orgId, agentId, opts.name);
  await storage.incrementUsage(orgId, 'agent_count', 1);
  return { orgId, agentId, apiKey, keyId };
}

// A login at the agent cap ends refused, so the polling CLI shows the upgrade link.
export async function completeCliPending(env: Env, id: string, opts: CliCompleteOptions): Promise<CliPendingRecord | PlanLimitBody | null> {
  const existing = await getPending(env, id);
  if (!existing || existing.status !== 'pending') return null;

  const minted = await mintAgentKey(env, { email: opts.email, orgId: opts.org_id, name: opts.agentName ?? 'CLI' });
  if ('code' in minted) {
    await completePending(env, id, { status: 'refused', error: minted.error, upgrade_url: minted.upgrade_url });
    return minted;
  }
  const { orgId, agentId, apiKey } = minted;

  return completePending(env, id, {
    status: 'complete',
    email: opts.email,
    org_id: orgId,
    agent_id: agentId,
    api_key: apiKey,
  });
}

export default app;

const htmlApp = new Hono<AppType>();

htmlApp.get('/v1/auth/providers', (c) => {
  return c.json({
    success: true,
    data: {
      google: !!(c.env.GOOGLE_OAUTH_CLIENT_ID && c.env.GOOGLE_OAUTH_CLIENT_SECRET),
      github: !!(c.env.GITHUB_OAUTH_CLIENT_ID && c.env.GITHUB_OAUTH_CLIENT_SECRET),
      email: true,
    },
  });
});

export { htmlApp };
