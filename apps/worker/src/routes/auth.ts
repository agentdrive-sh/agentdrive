import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { generateId } from '@agentdrive/shared';
import type { Env, AuthContext } from '../env.js';
import { flexAuth } from '../middleware/auth.js';
import { ipRateLimit } from '../middleware/rate-limit.js';
import { sendMagicCode, verifyMagicCode } from '../services/magic-codes.js';
import { storage } from '../lib/route-helpers.js';
import { selfHosted } from '../lib/self-hosted.js';

// /v1/auth — magic-link send/verify (public, rate-limited) + session me/logout
// (flexAuth-scoped). Mounts at /v1/auth.
//
// Sibling /v1/auth/cli routes still live in routes/cli-auth.ts and mount
// separately so the polling-style CLI flow has its own surface.

type Variables = { auth: AuthContext };
type AppType = { Bindings: Env; Variables: Variables };

const app = new Hono<AppType>();

const minutes = (seconds: number) => {
  const m = Math.ceil(seconds / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
};

function tooManyAttempts(c: Context<AppType>, retryAfter: number): Response {
  const others = [c.env.GOOGLE_OAUTH_CLIENT_ID && 'Google', c.env.GITHUB_OAUTH_CLIENT_ID && 'GitHub'].filter(Boolean).join(' or ');
  c.header('Retry-After', String(retryAfter));
  return c.json({
    success: false,
    code: 'too_many_attempts',
    error: `Too many wrong codes for this email. ${others ? `Sign in with ${others}, or try` : 'Try'} again in ${minutes(retryAfter)}.`,
  }, 429);
}

// Scope flexAuth to the session endpoints. Public send-code / verify-code
// run without auth (rate-limited only).
app.use('/me', flexAuth);
app.use('/logout', flexAuth);

// A self-hosted instance is API-key only: no dashboard to sign in to, and no stranger may
// make it email arbitrary addresses.
const emailSignInDisabled = createMiddleware<AppType>(async (c, next) => {
  if (!selfHosted(c.env)) return next();
  return c.json({ success: false, code: 'email_signin_disabled', error: 'Email sign-in is disabled on this self-hosted instance; use an API key' }, 501);
});
app.use('/send-code', emailSignInDisabled);
app.use('/verify-code', emailSignInDisabled);

app.post('/send-code', ipRateLimit('ip_magic'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({
    email: z.string().email(),
    purpose: z.enum(['verify', 'login']).default('login'),
    workspace_id: z.string().optional(),
    token_id: z.string().optional(),
  }).safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: 'valid email is required' }, 400);

  const result = await sendMagicCode(c.env, parsed.data.email, parsed.data.purpose, {
    workspace_id: parsed.data.workspace_id,
    token_id: parsed.data.token_id,
  });
  if (result.status === 'locked') return tooManyAttempts(c, result.retry_after);
  if (result.status === 'capped') {
    c.header('Retry-After', String(result.retry_after));
    return c.json({
      success: false,
      code: 'rate_limited',
      error: `Too many codes sent to this address. Try again in ${minutes(result.retry_after)}.`,
    }, 429);
  }
  if (result.status === 'failed') {
    // Don't pretend success — the old behavior swallowed transport failures
    // and told every user "code sent" even when nothing went out.
    return c.json(
      { success: false, error: 'Could not send the code right now. Please try again shortly.' },
      502,
    );
  }

  return c.json({ success: true, data: { message: 'Code sent to email' } });
});

app.post('/verify-code', ipRateLimit('ip_magic'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({
    email: z.string().email(),
    code: z.string().length(6),
  }).safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: 'email and 6-digit code are required' }, 400);

  const magic = await verifyMagicCode(c.env, parsed.data.email, parsed.data.code);
  if (magic.status === 'locked') return tooManyAttempts(c, magic.retry_after);
  if (magic.status === 'invalid') return c.json({ success: false, error: 'Invalid or expired code' }, 401);

  const s = storage(c);

  // Memberships and the sign-in index are keyed by lowercased email, as OAuth sign-in already does.
  const email = parsed.data.email.toLowerCase();
  const orgId = await s.getOrCreateOrgForEmail(email, c.env);

  const sessionId = generateId('sess');
  const session = await s.createSession(sessionId, email, orgId);

  return c.json({
    success: true,
    data: {
      session_id: session.session_id,
      email: session.email,
      org_id: session.org_id,
      expires_at: session.expires_at,
      context: magic.context,
    },
  });
});

app.get('/me', async (c) => {
  const auth = c.get('auth');
  if (auth.type === 'session') {
    const s = storage(c);
    let org = null;
    if (auth.org_id) {
      org = await s.getOrg(auth.org_id);
    }
    return c.json({ success: true, data: { type: 'session', email: auth.email, org_id: auth.org_id, org } });
  }
  if (auth.type === 'agent') {
    return c.json({ success: true, data: { type: 'agent', agent_id: auth.agent_id, agent_name: auth.agent_name, org_id: auth.org_id } });
  }
  return c.json({ success: true, data: { type: 'share', token_id: auth.token_id, permission: auth.permission } });
});

app.post('/logout', async (c) => {
  const auth = c.get('auth');
  if (auth.type !== 'session') return c.json({ success: false, error: 'Not a session' }, 400);
  const s = storage(c);
  await s.deleteSession(auth.session_id);
  return c.json({ success: true, data: { message: 'Logged out' } });
});

export default app;
