import { Hono } from 'hono';
import { z } from 'zod';
import { PAID_PLANS, TEAM_SEATS } from '@agentdrive/shared';
import type { Env, AuthContext } from '../env.js';
import { orgBilling } from '../durable-objects/billing-coordinator.js';
import { priceIds, invoiceAmount, stripeRequest } from '../services/stripe.js';
import { flexAuth } from '../middleware/auth.js';
import { canManageOrg, storage } from '../lib/route-helpers.js';
import { orgQuota, resumeEnforced, usageStatus } from '../services/limits.js';
import { monthlyMeter } from '../durable-objects/resume-meter.js';
import { resumeMonth } from '../services/storage.js';

// /v1/billing — plan readout + Stripe Checkout + Stripe Customer Portal.
// Mounts at /v1/billing.

type Variables = { auth: AuthContext };
type AppType = { Bindings: Env; Variables: Variables };

export const checkoutSchema = z.discriminatedUnion('plan', [
  z.object({ plan: z.literal('team'), seats: z.number().int().min(TEAM_SEATS.min).max(TEAM_SEATS.max).optional() }),
  z.object({ plan: z.literal('pro') }),
]);

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
  let resume_count: number | undefined;
  try {
    const { meter, prefix } = monthlyMeter(c.env, orgId, resumeMonth(new Date()));
    resume_count = await meter.count(prefix);
  } catch (err) {
    console.error(JSON.stringify({ event: 'resume_meter_error', org_id: orgId, op: 'plan' }), err);
  }
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
  const parsed = checkoutSchema.safeParse(body);
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

  try {
    const result = await orgBilling(c.env, orgId).checkout(orgId, parsed.data.plan, quantity, priceId);
    if (!result.success) return c.json({ success: false, error: result.error }, result.status);
    return c.json(result);
  } catch {
    return c.json({ success: false, error: 'Stripe checkout is temporarily unavailable' }, 502);
  }
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

  try {
    const portal = await stripeRequest<{ url: string }>(c.env, 'billing_portal/sessions', {
      customer: org.stripe_customer_id, return_url: returnUrl,
    });
    return c.json({ success: true, data: { url: portal.url } });
  } catch {
    return c.json({ success: false, error: 'Stripe portal session failed' }, 502);
  }
});

app.get('/invoices', async (c) => {
  const auth = c.get('auth');
  let orgId: string | undefined;
  if (auth.type === 'agent') orgId = auth.org_id;
  else if (auth.type === 'session') orgId = auth.org_id;
  if (!orgId) return c.json({ success: false, error: 'No organization' }, 404);

  const s = storage(c);
  if (!(await canManageOrg(s, auth, orgId))) {
    return c.json({ success: false, error: 'Only an org owner or admin can view invoices' }, 403);
  }
  const org = await s.getOrg(orgId);
  if (!org) return c.json({ success: false, error: 'Organization not found' }, 404);

  if (!org.stripe_customer_id) {
    return c.json({ success: true, data: [] });
  }

  if (!c.env.STRIPE_SECRET_KEY) return c.json({ success: false, error: 'Billing not configured' }, 503);

  interface StripeInvoices {
    data: Array<{
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
  }
  try {
    const body = await stripeRequest<StripeInvoices>(c.env, `invoices?customer=${encodeURIComponent(org.stripe_customer_id)}&limit=12`);
    const invoices = body.data.map((inv) => ({
      id: inv.number ?? inv.id,
      date: new Date(inv.created * 1000).toISOString().split('T')[0],
      total: invoiceAmount(inv.total ?? inv.amount_paid ?? 0, inv.currency ?? 'usd'),
      currency: inv.currency ?? 'usd',
      status: inv.status ?? 'open',
      pdfUrl: inv.invoice_pdf ?? inv.hosted_invoice_url ?? undefined,
      hostedUrl: inv.hosted_invoice_url ?? undefined,
    }));
    return c.json({ success: true, data: invoices });
  } catch {
    return c.json({ success: false, error: 'Invoice history is temporarily unavailable' }, 502);
  }
});

export default app;
