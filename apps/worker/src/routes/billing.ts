import { Hono } from 'hono';
import { z } from 'zod';
import { PAID_PLANS, TEAM_SEATS } from '@agentdrive/shared';
import type { PaidPlan } from '@agentdrive/shared';
import type { Env, AuthContext } from '../env.js';
import { flexAuth } from '../middleware/auth.js';
import { canManageOrg, storage } from '../lib/route-helpers.js';
import { orgQuota, resumeEnforced, usageStatus } from '../services/limits.js';
import { resumeMonth } from '../services/storage.js';

// /v1/billing — plan readout + Stripe Checkout + Stripe Customer Portal.
// Mounts at /v1/billing.

type Variables = { auth: AuthContext };
type AppType = { Bindings: Env; Variables: Variables };

// Price IDs live in CF secrets so prod and staging can differ without code changes.
export function priceIds(env: Env): Record<PaidPlan, string | undefined> {
  return { pro: env.STRIPE_PRICE_PRO, team: env.STRIPE_PRICE_TEAM };
}

export function stripeApi(env: Env, path: string, form?: Record<string, string>, idempotencyKey?: string): Promise<Response> {
  const auth = { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
  return fetch(`https://api.stripe.com/v1/${path}`, form
    ? {
        method: 'POST',
        headers: {
          ...auth,
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(idempotencyKey && { 'Idempotency-Key': idempotencyKey }),
        },
        body: new URLSearchParams(form),
      }
    : { headers: auth });
}

// Subscriptions that bill now, or will once their open invoice is paid.
const BILLING_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete']);

async function stripeErrorMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message ?? `Stripe request failed (${res.status})`;
}

const app = new Hono<AppType>();
app.use('*', flexAuth);

app.get('/plan', async (c) => {
  const auth = c.get('auth');
  let orgId: string | undefined;
  if (auth.type === 'agent') orgId = auth.org_id;
  else if (auth.type === 'session') orgId = auth.org_id;
  if (!orgId) return c.json({ success: false, error: 'No organization' }, 404);

  const s = storage(c);
  const org = await s.getOrg(orgId);
  if (!org) return c.json({ success: false, error: 'Organization not found' }, 404);

  const usage = await s.getUsage(orgId);
  const quota = orgQuota(org);
  const resume_count = await s.resumeMarkers(orgId, resumeMonth(new Date())).then((m) => m.length).catch((err) => {
    console.error(JSON.stringify({ event: 'resume_meter_error', org_id: orgId, op: 'plan' }), err);
    return undefined;
  });
  const resumes = resume_count === undefined ? undefined : { count: resume_count, enforced: resumeEnforced(c.env) };

  return c.json({
    success: true,
    data: {
      plan: org.plan,
      trial_ends_at: org.trial_ends_at,
      usage: { ...usage, resume_count },
      quota,
      status: usageStatus(org.plan, usage, c.env.SITE_URL, quota, resumes),
      stripe_customer_id: org.stripe_customer_id,
    },
  });
});

app.post('/checkout', async (c) => {
  const auth = c.get('auth');
  let orgId: string | undefined;
  if (auth.type === 'agent') { orgId = auth.org_id; }
  else if (auth.type === 'session') { orgId = auth.org_id; }
  else return c.json({ success: false, error: 'Forbidden' }, 403);

  if (!orgId) return c.json({ success: false, error: 'No organization' }, 404);
  const s = storage(c);
  // A checkout expires the org's other open checkouts and decides what the org pays for.
  if (!(await canManageOrg(s, auth, orgId))) {
    return c.json({ success: false, error: 'Only an org owner or admin can manage billing' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = z.discriminatedUnion('plan', [
    z.object({ plan: z.literal('team'), seats: z.number().int().min(TEAM_SEATS.min).max(TEAM_SEATS.max).optional() }),
    z.object({ plan: z.literal('pro') }),
  ]).safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: `plan is required (${PAID_PLANS.join('/')}); team seats must be a whole number from ${TEAM_SEATS.min} to ${TEAM_SEATS.max}` }, 400);
  }
  // Pro is a single-seat plan, so any seats sent with it are ignored.
  const quantity = parsed.data.plan === 'team' ? parsed.data.seats ?? TEAM_SEATS.min : 1;

  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json({ success: false, error: 'Billing not configured' }, 503);
  }

  const priceId = priceIds(c.env)[parsed.data.plan];
  if (!priceId) {
    return c.json({ success: false, error: `Billing not configured for plan: ${parsed.data.plan}` }, 503);
  }

  const org = await s.getOrg(orgId);
  if (!org) return c.json({ success: false, error: 'Organization not found' }, 404);
  let customerId = org.stripe_customer_id;
  if (customerId) {
    // Ask Stripe, not the org record: the webhook may lag, and an unpaid
    // subscription drops the plan to trial while it can still be revived.
    // Stripe's default listing skips canceled subscriptions, so one page holds every live one.
    const subsRes = await stripeApi(c.env, `subscriptions?customer=${encodeURIComponent(customerId)}&limit=100`);
    if (!subsRes.ok) return c.json({ success: false, error: await stripeErrorMessage(subsRes) }, 502);
    const subs = await subsRes.json() as { data: Array<{ status: string }> };
    if (subs.data.some((sub) => BILLING_STATUSES.has(sub.status))) {
      return c.json({ success: false, error: 'Already subscribed; manage your plan in the billing portal' }, 409);
    }
    // A Checkout left open in another tab could still be paid and start a second subscription.
    const openRes = await stripeApi(c.env, `checkout/sessions?customer=${encodeURIComponent(customerId)}&status=open&limit=100`);
    if (!openRes.ok) return c.json({ success: false, error: await stripeErrorMessage(openRes) }, 502);
    for (const open of (await openRes.json() as { data: Array<{ id: string }> }).data) {
      const expireRes = await stripeApi(c.env, `checkout/sessions/${encodeURIComponent(open.id)}/expire`, {});
      if (!expireRes.ok) return c.json({ success: false, error: await stripeErrorMessage(expireRes) }, 502);
    }
  } else {
    // Concurrent first checkouts must not mint two customers for one org.
    const customerRes = await stripeApi(c.env, 'customers', {
      'metadata[org_id]': orgId,
      'name': org.name,
    }, `customer-${orgId}`);
    if (!customerRes.ok) {
      return c.json({ success: false, error: await stripeErrorMessage(customerRes) }, 502);
    }
    const customer = await customerRes.json() as { id: string };
    customerId = customer.id;
    await s.updateOrg(orgId, { stripe_customer_id: customerId });
  }

  const checkoutRes = await stripeApi(c.env, 'checkout/sessions', {
      'customer': customerId,
      'mode': 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': String(quantity),
      'success_url': `${c.env.SITE_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      'cancel_url': `${c.env.SITE_URL}/billing/cancel`,
      'metadata[org_id]': orgId,
      'metadata[plan]': parsed.data.plan,
      // Subscription events carry the subscription's metadata, not the session's.
      'subscription_data[metadata][org_id]': orgId,
      'subscription_data[metadata][plan]': parsed.data.plan,
      'subscription_data[metadata][seats]': String(quantity),
      'allow_promotion_codes': 'true',
      'billing_address_collection': 'required',
  });
  if (!checkoutRes.ok) {
    return c.json({ success: false, error: await stripeErrorMessage(checkoutRes) }, 502);
  }

  const session = await checkoutRes.json() as { id: string; url: string };

  return c.json({ success: true, data: { checkout_url: session.url, session_id: session.id } });
});

app.post('/portal', async (c) => {
  const auth = c.get('auth');
  let orgId: string | undefined;
  if (auth.type === 'agent') orgId = auth.org_id;
  else if (auth.type === 'session') orgId = auth.org_id;
  else return c.json({ success: false, error: 'Forbidden' }, 403);

  if (!orgId) return c.json({ success: false, error: 'No organization' }, 404);
  const s = storage(c);
  // The portal cancels the subscription and changes how the org pays.
  if (!(await canManageOrg(s, auth, orgId))) {
    return c.json({ success: false, error: 'Only an org owner or admin can manage billing' }, 403);
  }
  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json({ success: false, error: 'Billing not configured' }, 503);
  }

  const org = await s.getOrg(orgId);
  if (!org) return c.json({ success: false, error: 'Organization not found' }, 404);
  if (!org.stripe_customer_id) {
    return c.json({ success: false, error: 'No Stripe customer yet — subscribe first via /v1/billing/checkout' }, 409);
  }

  const cli = c.req.query('cli') === '1';
  const returnUrl = `${c.env.SITE_URL}/billing${cli ? '?cli=1' : ''}`;

  const portalRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${c.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      customer: org.stripe_customer_id,
      return_url: returnUrl,
    }),
  });
  if (!portalRes.ok) {
    return c.json({ success: false, error: 'Stripe portal session failed' }, 502);
  }
  const portal = await portalRes.json() as { url: string };
  return c.json({ success: true, data: { url: portal.url } });
});

// GET /v1/billing/invoices — Stripe-backed invoice history for the org's
// customer. Returns [] for orgs that have never checked out (no customer yet)
// or when billing isn't configured, so the dashboard always renders cleanly.
app.get('/invoices', async (c) => {
  const auth = c.get('auth');
  let orgId: string | undefined;
  if (auth.type === 'agent') orgId = auth.org_id;
  else if (auth.type === 'session') orgId = auth.org_id;
  if (!orgId) return c.json({ success: false, error: 'No organization' }, 404);

  const s = storage(c);
  const org = await s.getOrg(orgId);
  if (!org) return c.json({ success: false, error: 'Organization not found' }, 404);

  if (!c.env.STRIPE_SECRET_KEY || !org.stripe_customer_id) {
    return c.json({ success: true, data: [] });
  }

  const res = await fetch(
    `https://api.stripe.com/v1/invoices?customer=${encodeURIComponent(org.stripe_customer_id)}&limit=12`,
    { headers: { Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}` } },
  );
  if (!res.ok) return c.json({ success: true, data: [] });

  const body = await res.json() as {
    data?: Array<{
      id: string;
      number?: string;
      created: number;
      total?: number;
      amount_paid?: number;
      currency?: string;
      status?: string;
      invoice_pdf?: string;
      hosted_invoice_url?: string;
    }>;
  };

  const invoices = (body.data ?? []).map((inv) => ({
    id: inv.number ?? inv.id,
    date: new Date(inv.created * 1000).toISOString().split('T')[0],
    total: (inv.total ?? inv.amount_paid ?? 0) / 100,
    currency: inv.currency ?? 'usd',
    status: inv.status ?? 'open',
    pdfUrl: inv.invoice_pdf ?? inv.hosted_invoice_url,
  }));

  return c.json({ success: true, data: invoices });
});

export default app;
