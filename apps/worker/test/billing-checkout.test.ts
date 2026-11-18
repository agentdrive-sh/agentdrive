import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { PLAN_CATALOG } from '@agentdrive/shared';
import { deliveredCode } from './magic-code-helper';

interface StripeCall { url: string; body: URLSearchParams; headers: Headers }

const calls: StripeCall[] = [];
let stripe: (url: string) => Response;

beforeEach(() => {
  calls.length = 0;
  stripe = (url) => {
    if (url.endsWith('/v1/customers')) return Response.json({ id: 'cus_1' });
    if (url.includes('/v1/subscriptions?') || url.includes('/v1/checkout/sessions?')) return Response.json({ data: [] });
    return Response.json({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' });
  };
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (...args: Parameters<typeof fetch>) => {
    const req = args[0] instanceof Request ? args[0] : new Request(...args);
    if (!req.url.startsWith('https://api.stripe.com/')) return realFetch(...args);
    calls.push({ url: req.url, body: new URLSearchParams(await req.text()), headers: req.headers });
    return stripe(req.url);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function registerAgent(): Promise<{ api_key: string; org_id: string }> {
  const res = await SELF.fetch('http://localhost/v1/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_name: 'BuyBot', org_name: 'BuyCo' }),
  });
  return ((await res.json()) as { data: { api_key: string; org_id: string } }).data;
}

function checkout(apiKey: string, plan: string, seats?: unknown): Promise<Response> {
  return SELF.fetch('http://localhost/v1/billing/checkout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan, seats }),
  });
}

function sessionForm(): URLSearchParams {
  return calls.find((c) => c.url.endsWith('/v1/checkout/sessions'))!.body;
}

async function setOrg(orgId: string, fields: Record<string, unknown>): Promise<void> {
  const org = await env.KV.get<Record<string, unknown>>(`org:${orgId}`, 'json');
  await env.KV.put(`org:${orgId}`, JSON.stringify({ ...org, ...fields }));
}

function existingCustomer(subscriptions: Array<{ status: string }>, openSessions: Array<{ id: string }> = []) {
  stripe = (url) => {
    if (url.includes('/v1/subscriptions?')) return Response.json({ data: subscriptions });
    if (url.includes('/v1/checkout/sessions?')) return Response.json({ data: openSessions });
    if (url.endsWith('/expire')) return Response.json({ status: 'expired' });
    return Response.json({ id: 'cs_new', url: 'https://checkout.stripe.com/c/cs_new' });
  };
}

async function orgCustomerId(orgId: string): Promise<unknown> {
  const org = await env.KV.get<Record<string, unknown>>(`org:${orgId}`, 'json');
  return org?.stripe_customer_id;
}

describe('POST /v1/billing/checkout', () => {
  it('creates a session carrying org metadata on the subscription, promo codes and address collection', async () => {
    const agent = await registerAgent();
    const res = await checkout(agent.api_key, 'team');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { checkout_url: string } };
    expect(body.data.checkout_url).toBe('https://checkout.stripe.com/c/cs_1');

    const session = calls.find((c) => c.url.endsWith('/v1/checkout/sessions'))!.body;
    expect(session.get('customer')).toBe('cus_1');
    expect(session.get('line_items[0][price]')).toBe('price_test_team');
    expect(session.get('subscription_data[metadata][org_id]')).toBe(agent.org_id);
    expect(session.get('subscription_data[metadata][plan]')).toBe('team');
    expect(session.get('allow_promotion_codes')).toBe('true');
    expect(session.get('billing_address_collection')).toBe('required');
    // Buyers return to the site they signed in on, not the API host.
    expect(session.get('success_url')).toMatch(/^http:\/\/localhost:3001\/billing\/success\?/);
    expect(session.get('cancel_url')).toBe('http://localhost:3001/billing/cancel');
    // Stripe rejects payment_method_types on Checkout; methods are set per account
    // (bank debits stay disabled there).
    expect([...session.keys()].some((k) => k.startsWith('payment_method_types'))).toBe(false);
    expect(await orgCustomerId(agent.org_id)).toBe('cus_1');
    const customerCall = calls.find((c) => c.url.endsWith('/v1/customers'))!;
    expect(customerCall.headers.get('idempotency-key')).toBe(`customer-${agent.org_id}`);
  });

  it('returns 502 and saves no customer when customer creation fails', async () => {
    stripe = () => Response.json({ error: { message: 'Invalid API Key provided' } }, { status: 401 });
    const agent = await registerAgent();
    const res = await checkout(agent.api_key, 'pro');
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain('temporarily unavailable');
    expect(await orgCustomerId(agent.org_id)).toBeUndefined();
  });

  it('allows a corrected checkout after Stripe rejects the requested price', async () => {
    stripe = (url) => {
      if (url.endsWith('/v1/customers')) return Response.json({ id: 'cus_2' });
      if (url.endsWith('/v1/checkout/sessions')) {
        return Response.json({ error: { type: 'invalid_request_error', message: 'No such price' } }, { status: 400 });
      }
      return Response.json({ data: [] });
    };
    const agent = await registerAgent();
    const res = await checkout(agent.api_key, 'pro');
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain('temporarily unavailable');
    existingCustomer([]);
    expect((await checkout(agent.api_key, 'team')).status).toBe(200);
    const creates = calls.filter(c => c.url.endsWith('/v1/checkout/sessions'));
    expect(creates.map(c => c.body.get('metadata[plan]'))).toEqual(['pro', 'team']);
  });

  it('refuses a second subscription while the customer has one that still bills (plan switches go through the portal)', async () => {
    for (const status of ['active', 'unpaid', 'past_due']) {
      const agent = await registerAgent();
      await setOrg(agent.org_id, { plan: 'trial', stripe_customer_id: 'cus_live' });
      existingCustomer([{ status: 'canceled' }, { status }]);
      calls.length = 0;
      const res = await checkout(agent.api_key, 'team');
      expect(res.status, status).toBe(409);
      expect(calls.some((c) => c.url.endsWith('/v1/checkout/sessions'))).toBe(false);
    }
  });

  it('expires checkout sessions left open in other tabs before opening a new one', async () => {
    const agent = await registerAgent();
    await setOrg(agent.org_id, { stripe_customer_id: 'cus_back' });
    existingCustomer([{ status: 'canceled' }], [{ id: 'cs_old' }]);
    const res = await checkout(agent.api_key, 'pro');
    expect(res.status).toBe(200);
    const urls = calls.map((c) => c.url);
    expect(urls).toContain('https://api.stripe.com/v1/checkout/sessions/cs_old/expire');
    expect(urls.indexOf('https://api.stripe.com/v1/checkout/sessions/cs_old/expire'))
      .toBeLessThan(urls.indexOf('https://api.stripe.com/v1/checkout/sessions'));
  });

  it('bills team per seat: 3 by default, the requested count otherwise, recorded on the subscription', async () => {
    const agent = await registerAgent();
    expect((await checkout(agent.api_key, 'team')).status).toBe(200);
    expect(sessionForm().get('line_items[0][quantity]')).toBe('3');
    expect(sessionForm().get('subscription_data[metadata][seats]')).toBe('3');

    calls.length = 0;
    const other = await registerAgent();
    expect((await checkout(other.api_key, 'team', 12)).status).toBe(200);
    expect(sessionForm().get('line_items[0][quantity]')).toBe('12');
    expect(sessionForm().get('subscription_data[metadata][seats]')).toBe('12');
  });

  it('serializes concurrent checkouts and returns the same Stripe session', async () => {
    const agent = await registerAgent();
    const session = { id: 'cs_same', status: 'open', url: 'https://checkout.stripe.com/c/cs_same',
      metadata: { org_id: agent.org_id, price: 'price_test_team', seats: '4' } };
    let created = false;
    stripe = (url) => {
      if (url.endsWith('/customers')) return Response.json({ id: 'cus_concurrent' });
      if (url.includes('subscriptions?')) return Response.json({ data: [] });
      if (url.includes('sessions?')) return Response.json({ data: created ? [session] : [] });
      if (url.endsWith('/cs_same')) return Response.json(session);
      if (url.endsWith('/sessions')) { created = true; return Response.json(session); }
      throw new Error('Unexpected Stripe request');
    };
    const results = await Promise.all([checkout(agent.api_key, 'team', 4), checkout(agent.api_key, 'team', 4)]);
    for (const res of results) {
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ data: { session_id: 'cs_same' } });
    }
    expect(calls.filter(c => c.url.endsWith('/sessions'))).toHaveLength(1);
  });

  it('recovers the original idempotency key after a lost creation response', async () => {
    const agent = await registerAgent();
    const session = { id: 'cs_lost', status: 'open', url: 'https://checkout.stripe.com/c/cs_lost',
      metadata: { org_id: agent.org_id, price: 'price_test_pro', seats: '1' } };
    let lost = false;
    stripe = (url) => {
      if (url.endsWith('/customers')) return Response.json({ id: 'cus_retry' });
      if (url.includes('subscriptions?') || url.includes('sessions?')) return Response.json({ data: [] });
      if (url.endsWith('/sessions') && !lost) { lost = true; throw new Error('Response lost'); }
      return Response.json(session);
    };
    expect((await checkout(agent.api_key, 'pro')).status).toBe(502);
    expect((await checkout(agent.api_key, 'pro')).status).toBe(200);
    const creates = calls.filter(c => c.url.endsWith('/sessions'));
    expect(creates).toHaveLength(2);
    expect(creates[0]!.headers.get('idempotency-key')).toBeTruthy();
    expect(creates[1]!.headers.get('idempotency-key')).toBe(creates[0]!.headers.get('idempotency-key'));
  });

  it('recovers a committed Stripe session even when its creation key cached a 500', async () => {
    const agent = await registerAgent();
    let attempt: string | null = null;
    stripe = (url) => {
      if (url.endsWith('/customers')) return Response.json({ id: 'cus_cached' });
      if (url.includes('subscriptions?')) return Response.json({ data: [] });
      if (url.includes('sessions?')) return Response.json({ data: attempt ? [{
        id: 'cs_cached', status: 'open', url: 'https://checkout.stripe.com/c/cs_cached',
        metadata: { org_id: agent.org_id, price: 'price_test_pro', seats: '1', attempt },
      }] : [] });
      attempt = calls.at(-1)!.body.get('metadata[attempt]');
      return Response.json({}, { status: 500 });
    };
    expect((await checkout(agent.api_key, 'pro')).status).toBe(502);
    const retried = await checkout(agent.api_key, 'pro');
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({ data: { session_id: 'cs_cached' } });
    expect(calls.filter(c => c.url.endsWith('/sessions'))).toHaveLength(1);
  });

  it('rejects team seats below 3, above 100 or fractional with 400', async () => {
    const agent = await registerAgent();
    for (const seats of [2, 101, 3.5, '5']) {
      expect((await checkout(agent.api_key, 'team', seats)).status, String(seats)).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it('ignores seats for pro', async () => {
    const agent = await registerAgent();
    expect((await checkout(agent.api_key, 'pro', 10)).status).toBe(200);
    expect(sessionForm().get('line_items[0][quantity]')).toBe('1');
    expect((await checkout(agent.api_key, 'pro', 1)).status).toBe(200);
  });

  it('rejects the retired business plan with 400', async () => {
    const agent = await registerAgent();
    const res = await checkout(agent.api_key, 'business');
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('who manages billing', () => {
  function call(path: string, method: string, headers: Record<string, string>, body?: unknown): Promise<Response> {
    return SELF.fetch(`http://localhost/v1${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function joinAs(email: string, role: string, inviter: Record<string, string>, orgId: string): Promise<Record<string, string>> {
    expect((await call('/org/invite', 'POST', inviter, { email, role })).status).toBe(201);
    const signedIn = await call('/auth/verify-code', 'POST', {}, { email, code: await deliveredCode(email) });
    const who = { 'X-Session-Token': ((await signedIn.json()) as { data: { session_id: string } }).data.session_id };
    expect((await call(`/org/invites/${orgId}/accept`, 'POST', who)).status).toBe(200);
    return who;
  }

  // The Stripe portal cancels the subscription and changes how the org pays.
  it('opens only for an org owner or admin and their keys, never a plain member or a key a member made', async () => {
    const agent = await registerAgent();
    await setOrg(agent.org_id, { stripe_customer_id: 'cus_1', plan: 'team', seats: 10 });
    const founder = { Authorization: `Bearer ${agent.api_key}` };
    const member = await joinAs('member@example.com', 'member', founder, agent.org_id);
    const admin = await joinAs('lead@example.com', 'admin', founder, agent.org_id);
    const memberKey = await call('/keys', 'POST', member, { name: 'member cli' });
    const memberAgent = { Authorization: `Bearer ${((await memberKey.json()) as { data: { api_key: string } }).data.api_key}` };
    const portalCalls = () => calls.filter((c) => c.url.includes('/v1/billing_portal/sessions')).length;

    expect((await call('/billing/portal', 'POST', member)).status).toBe(403);
    expect((await call('/billing/portal', 'POST', memberAgent)).status).toBe(403);
    expect((await call('/billing/invoices', 'GET', member)).status).toBe(403);
    expect((await call('/billing/invoices', 'GET', memberAgent)).status).toBe(403);
    expect(calls.some(c => c.url.includes('/invoices?'))).toBe(false);
    expect(portalCalls()).toBe(0);

    expect((await call('/billing/portal', 'POST', admin)).status).toBe(200);
    expect((await call('/billing/portal', 'POST', founder)).status).toBe(200);
    expect(portalCalls()).toBe(2);
  });

  // A checkout expires the org's other open checkouts and picks what the org pays for.
  it('lets an owner and an admin check out, and refuses a plain member', async () => {
    const signedIn = await call('/auth/verify-code', 'POST', {}, { email: 'boss@example.com', code: await deliveredCode('boss@example.com') });
    const { session_id, org_id } = ((await signedIn.json()) as { data: { session_id: string; org_id: string } }).data;
    const owner = { 'X-Session-Token': session_id };
    await setOrg(org_id, { plan: 'team', seats: 10 });
    const admin = await joinAs('lead@example.com', 'admin', owner, org_id);
    const member = await joinAs('member@example.com', 'member', owner, org_id);
    const checkoutAs = (who: Record<string, string>) => call('/billing/checkout', 'POST', who, { plan: 'team' });

    expect((await checkoutAs(member)).status).toBe(403);
    expect(calls).toHaveLength(0);
    expect((await checkoutAs(owner)).status).toBe(200);
    expect((await checkoutAs(admin)).status).toBe(200);
  });
});

describe('GET /v1/billing/invoices', () => {
  it('distinguishes an empty history from a Stripe failure and respects currency units', async () => {
    const agent = await registerAgent();
    const invoices = () => SELF.fetch('http://localhost/v1/billing/invoices', {
      headers: { Authorization: `Bearer ${agent.api_key}` },
    });
    expect(await (await invoices()).json()).toMatchObject({ data: [] });
    await setOrg(agent.org_id, { stripe_customer_id: 'cus_1' });
    stripe = () => Response.json({}, { status: 503 });
    expect((await invoices()).status).toBe(502);
    stripe = () => Response.json({ data: ['jpy', 'eur', 'isk'].map(currency => ({
      id: currency, total: 1200, currency, created: 1, status: 'paid',
    })) });
    expect(await (await invoices()).json()).toMatchObject({ data: [
      { total: 1200, currency: 'jpy' }, { total: 12, currency: 'eur' }, { total: 12, currency: 'isk' },
    ] });
  });
});

describe('PLAN_CATALOG', () => {
  it('derives limit bullets from PLAN_QUOTAS', () => {
    expect(PLAN_CATALOG[0].id).toBe('free');
    expect(PLAN_CATALOG.find((p) => p.id === 'pro')!.features).toContain('50 GB storage (soft limit)');
  });

  it('draws the paid line at cross-agent resumes, with no embeddings or history bullets', () => {
    const features = (id: string) => PLAN_CATALOG.find((p) => p.id === id)!.features;
    expect(features('free')).toContain('10 cross-agent resumes a month');
    expect(features('free')).toContain('1 GB storage (soft limit)');
    expect(features('pro')).toContain('Unlimited cross-agent resumes');
    expect(features('team')).toContain('Unlimited cross-agent resumes');
    for (const plan of PLAN_CATALOG) {
      expect(plan.features.join('\n')).not.toMatch(/embeddings|session history/i);
    }
  });
});
