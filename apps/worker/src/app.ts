import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { Env, AuthContext } from './env.js';
import { corsMiddleware } from './middleware/cors.js';
import { rateLimitPolicyHeader } from './middleware/rate-limit.js';
import { orgBilling } from './durable-objects/billing-coordinator.js';
import { constructStripeEvent } from './services/stripe-webhook.js';
import searchRoutes from './routes/search.js';
import runsRoutes from './routes/runs.js';
import contextRoutes from './routes/context.js';
import sandboxRoutes from './routes/sandbox.js';
import installerRoutes from './routes/installer.js';
import cliAuthRoutes, { htmlApp as cliAuthHtmlApp } from './routes/cli-auth.js';
import oauthRoutes from './routes/oauth.js';
import filesRoutes from './routes/files.js';
import workspacesRoutes from './routes/workspaces.js';
import sharesRoutes from './routes/shares.js';
import rolesRoutes from './routes/roles.js';
import commentsRoutes from './routes/comments.js';
import activityRoutes from './routes/activity.js';
import orgsRoutes from './routes/orgs.js';
import keysRoutes from './routes/keys.js';
import billingRoutes from './routes/billing.js';
import authRoutes from './routes/auth.js';
import registerRoutes from './routes/register.js';
import tokenInfoRoutes from './routes/token-info.js';
import timelineRoutes from './routes/timeline.js';
import bucketConfigRoutes from './routes/bucket-config.js';
import { WORKER_HEALTH_VERSION } from './generated/version.js';
import { storageReadiness } from './services/health.js';
import { selfHosted } from './lib/self-hosted.js';

type Variables = { auth: AuthContext };
type AppType = { Bindings: Env; Variables: Variables };

export const app = new Hono<AppType>();

app.use('*', corsMiddleware);

// The code an error body gets when its route set none, so every /v1 error carries one.
export const DEFAULT_ERROR_CODES: Record<number, string> = {
  400: 'invalid_request',
  401: 'unauthorized',
  402: 'payment_required',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  422: 'unprocessable',
  429: 'rate_limited',
  500: 'internal_error',
  501: 'not_implemented',
  502: 'upstream_error',
  503: 'unavailable',
};

app.use('/v1/*', async (c, next) => {
  await next();
  const { status, headers } = c.res;
  if (status < 400 || !headers.get('Content-Type')?.startsWith('application/json')) return;
  const body = await c.res.clone().json().catch(() => null) as { success?: unknown; code?: unknown } | null;
  if (body?.success !== false || typeof body.code === 'string') return;
  const coded = new Headers(headers);
  coded.delete('Content-Length');
  c.res = undefined;
  c.res = new Response(JSON.stringify({ ...body, code: DEFAULT_ERROR_CODES[status] ?? `http_${status}` }), { status, headers: coded });
});
app.use('/v1/*', rateLimitPolicyHeader);

// A self-hosted instance has no Stripe account and no plan to upgrade to.
const billingDisabled = createMiddleware<AppType>(async (c, next) => {
  if (!selfHosted(c.env)) return next();
  return c.json({ success: false, code: 'billing_disabled', error: 'Billing is disabled on this self-hosted AgentDrive instance' }, 501);
});
app.use('/v1/billing/*', billingDisabled);
app.use('/v1/webhooks/stripe', billingDisabled);

// Health (no auth). Version is generated at build time from
// packages/mcp-server/package.json — see apps/installer/build-version.mjs.
app.get('/v1/health', async (c) => {
  const checks = await storageReadiness(c.env);
  const ready = checks.kv === 'ok' && checks.r2 === 'ok';
  c.header('Cache-Control', 'no-store');
  const body = { status: ready ? 'ok' : 'unavailable', version: WORKER_HEALTH_VERSION, checks } as const;
  if (ready) return c.json(body);
  return c.json({ success: false, code: 'storage_unavailable', error: 'KV or R2 is not answering reads', ...body }, 503);
});

// Mount order matters: more-specific public sub-apps go BEFORE the generic
// /v1/* wildcard so flexAuth doesn't shadow their unauth endpoints.
//
// CLI polling auth (start/poll) — public.
app.route('/v1/auth/cli', cliAuthRoutes);
// Google/GitHub OAuth callbacks — public.
app.route('/auth/oauth', oauthRoutes);
// Configured sign-in providers — public. /cli-auth is the site's confirmation page; the
// catch-all below forwards app.agentdrive.sh/cli-auth links to it.
app.route('/', cliAuthHtmlApp);

// Magic-link send/verify + session me/logout. send/verify are public + rate-
// limited; me/logout are flexAuth-scoped inside the sub-app.
app.route('/v1/auth', authRoutes);

// Agent self-service registration — public + rate-limited.
app.route('/v1/register', registerRoutes);

// Share-token metadata readout — public, for frontend pre-flight.
app.route('/v1/token-info', tokenInfoRoutes);

// Authenticated REST surfaces. Each sub-app installs flexAuth on '*' so they
// independently enforce auth; index.ts no longer owns a shared `api` parent.
app.route('/v1/workspaces/:wid/files/:fid/comments', commentsRoutes);
app.route('/v1/workspaces/:wid/files', filesRoutes);
app.route('/v1/workspaces/:wid/share', sharesRoutes);
app.route('/v1/workspaces/:wid/roles', rolesRoutes);
app.route('/v1/workspaces/:wid/activity', activityRoutes);
app.route('/v1/workspaces/:wid/sandbox', sandboxRoutes);
app.route('/v1/workspaces', workspacesRoutes);
app.route('/v1/org/timeline', timelineRoutes);
app.route('/v1/bucket-config', bucketConfigRoutes);
app.route('/v1/org', orgsRoutes);
app.route('/v1/keys', keysRoutes);
app.route('/v1/billing', billingRoutes);
app.route('/v1/search', searchRoutes);
app.route('/v1/runs', runsRoutes);
app.route('/v1/context', contextRoutes);

// Public installer script served at /install and /install.sh
app.route('/', installerRoutes);

// --- Stripe Webhook (no auth, verified by signature) ---

app.post('/v1/webhooks/stripe', async (c) => {
  if (!c.env.STRIPE_WEBHOOK_SECRET || !c.env.STRIPE_SECRET_KEY) {
    return c.json({ success: false, error: 'Not configured' }, 503);
  }

  const signature = c.req.header('stripe-signature');
  const rawBody = await c.req.text();

  const event = await constructStripeEvent(rawBody, signature, c.env.STRIPE_WEBHOOK_SECRET);
  if (!event) return c.json({ success: false, error: 'Invalid signature' }, 400);

  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const fromCheckout = event.type === 'checkout.session.completed';
    const obj = event.data.object as { id?: string; subscription?: string; metadata?: { org_id?: string } };
    const subId = fromCheckout ? obj.subscription : obj.id;
    const orgId = obj.metadata?.org_id;
    if (orgId && subId) {
      const synced = await orgBilling(c.env, orgId).reconcile(orgId, subId, fromCheckout).catch(() => false);
      if (!synced) return c.json({ success: false, error: 'Subscription reconciliation failed' }, 502);
    }
  }

  return c.json({ received: true });
});

// Live collaboration is not part of this release. The former binary update
// relay did not merge Yjs state or enforce edit permissions; fail explicitly
// until the complete protocol is supported, rather than accepting unsafe edits.
app.get('/v1/workspaces/:wid/files/:fid/collaborate', async (c) => {
  return c.json({ success: false, code: 'collaboration_unavailable', error: 'Live collaboration is not available in this release' }, 503);
});

// 404 for API routes only
app.all('/v1/*', (c) => c.json({ success: false, error: 'Not found' }, 404));

app.get('/.well-known/openai-apps-challenge', (c) => {
  const challenge = c.env.OPENAI_APPS_CHALLENGE;
  if (!challenge || new URL(c.req.url).origin !== new URL(c.env.MCP_URL).origin) return c.notFound();
  return c.text(challenge, 200, { 'Cache-Control': 'no-store' });
});

// Anything else that lands on the API worker (e.g. api.agentdrive.sh/something)
// bounces to the marketing site. The Next.js worker at agentdrive.sh serves the
// real frontend; this worker is API-only.
app.get('*', (c) => {
  const { host, pathname, search } = new URL(c.req.url);
  // agentdrive.sh/auth/* is routed here too: redirecting the site's host to itself loops.
  if (host === 'agentdrive.sh') return c.json({ success: false, error: 'Not found' }, 404);
  return c.redirect('https://agentdrive.sh' + pathname + search, 308);
});

// Error handler
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error('Unhandled error:', err);
  return c.json({ success: false, error: 'Internal server error' }, 500);
});
