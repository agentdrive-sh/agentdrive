import { Hono } from 'hono';
import { z } from 'zod';
import { generateId, hashApiKey } from '@agentdrive/shared';
import type { OrgMeta, Plan } from '@agentdrive/shared';
import type { Env, AuthContext } from '../env.js';
import { ipRateLimit } from '../middleware/rate-limit.js';
import { storage, emailService } from '../lib/route-helpers.js';
import { REGISTRATION_CLOSED, SELF_HOSTED_ORG_ID, bootstrapAllowed, selfHosted } from '../lib/self-hosted.js';

// POST /v1/register — agent self-service registration.

type Variables = { auth: AuthContext };
type AppType = { Bindings: Env; Variables: Variables };

export const registerSchema = z.object({
  agent_name: z.string().min(1).max(100),
  org_name: z.string().min(1).max(100).optional(),
});

const app = new Hono<AppType>();

app.post('/', ipRateLimit('ip_register'), async (c) => {
  if (selfHosted(c.env) && !bootstrapAllowed(c.env, c.req.header('X-Bootstrap-Token'))) return c.json(REGISTRATION_CLOSED, 403);
  const body = await c.req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: 'agent_name is required (1-100 chars)' }, 400);

  const s = storage(c);
  const email = emailService(c);

  const agentId = generateId('ag');
  const apiKey = `agentdrive_live_${generateId()}${generateId()}`;
  let orgId: string;
  let org: OrgMeta;
  if (selfHosted(c.env)) {
    // Checked above: only the bootstrap token gets here. The instance keeps a single org, and
    // a token register on it makes the new key its founding agent, which is how a lost owner
    // key is recovered and why a retried register only adds an extra key.
    const others = (await c.env.KV.list({ prefix: 'org:', limit: 2 })).keys.filter((k) => k.name !== `org:${SELF_HOSTED_ORG_ID}`);
    if (others.length) throw new Error(`self-hosted instance holds an org other than ${SELF_HOSTED_ORG_ID}: ${others[0]!.name}`);
    orgId = SELF_HOSTED_ORG_ID;
    const existing = await s.getOrg(orgId);
    if (existing) {
      await s.updateOrg(orgId, { created_by: agentId });
      org = { ...existing, created_by: agentId };
    } else {
      org = await s.createOrg(orgId, parsed.data.org_name || 'Self-hosted', agentId, c.env, true);
    }
  } else {
    orgId = generateId('org');
    org = await s.createOrg(orgId, parsed.data.org_name || `${parsed.data.agent_name}'s org`, agentId, c.env);
  }

  const keyHash = await hashApiKey(apiKey);
  const prefix = `${apiKey.slice(0, 22)}…${apiKey.slice(-4)}`;
  await s.createApiKey(orgId, agentId, parsed.data.agent_name, keyHash, prefix);

  let agentEmail: string | undefined;
  let agentClaimUrl: string | undefined;

  const inbox = await email.registerAgentInbox(
    agentId.replace('ag_', ''),
    parsed.data.agent_name,
  );
  if (inbox) {
    agentEmail = inbox.email;
    agentClaimUrl = inbox.claim_url;
  }

  await s.addOrgAgent(orgId, agentId, parsed.data.agent_name, agentEmail);
  await s.incrementUsage(orgId, 'agent_count', 1);

  return c.json({
    success: true,
    data: {
      agent_id: agentId,
      api_key: apiKey,
      org_id: orgId,
      org_name: org.name,
      plan: 'trial' as Plan,
      trial_ends_at: org.trial_ends_at,
      agent_email: agentEmail,
      agent_claim_url: agentClaimUrl,
    },
  }, 201);
});

export default app;
