import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { constructStripeEvent } from '../src/services/stripe-webhook';

// The endpoint secret must match vitest.config.ts STRIPE_WEBHOOK_SECRET for the
// integration cases to exercise the configured path.
const SECRET = 'whsec_test_do-not-use';

async function sign(payload: string, timestamp: number, secret = SECRET): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${payload}`));
  const bytes = new Uint8Array(mac);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

const body = JSON.stringify({
  type: 'checkout.session.completed',
  data: { object: { metadata: { org_id: 'org_x', plan: 'pro' } } },
});

describe('constructStripeEvent', () => {
  it('accepts a valid signature within tolerance', async () => {
    const t = Math.floor(Date.now() / 1000);
    const event = await constructStripeEvent(body, `t=${t},v1=${await sign(body, t)}`, SECRET);
    expect(event?.type).toBe('checkout.session.completed');
  });

  it('accepts when one of several v1 signatures matches (key rotation)', async () => {
    const t = Math.floor(Date.now() / 1000);
    const header = `t=${t},v1=deadbeef,v1=${await sign(body, t)}`;
    const event = await constructStripeEvent(body, header, SECRET);
    expect(event?.type).toBe('checkout.session.completed');
  });

  it('rejects a forged signature', async () => {
    const t = Math.floor(Date.now() / 1000);
    expect(await constructStripeEvent(body, `t=${t},v1=deadbeef`, SECRET)).toBeNull();
  });

  it('rejects a signature computed with the wrong secret', async () => {
    const t = Math.floor(Date.now() / 1000);
    const header = `t=${t},v1=${await sign(body, t, 'whsec_wrong')}`;
    expect(await constructStripeEvent(body, header, SECRET)).toBeNull();
  });

  it('rejects a tampered body that keeps the original signature', async () => {
    const t = Math.floor(Date.now() / 1000);
    const header = `t=${t},v1=${await sign(body, t)}`;
    const tampered = body.replace('pro', 'team');
    expect(await constructStripeEvent(tampered, header, SECRET)).toBeNull();
  });

  it('rejects a stale timestamp outside the replay tolerance', async () => {
    const stale = Math.floor(Date.now() / 1000) - 1000;
    const header = `t=${stale},v1=${await sign(body, stale)}`;
    expect(await constructStripeEvent(body, header, SECRET)).toBeNull();
  });

  it('rejects a missing or malformed header', async () => {
    expect(await constructStripeEvent(body, undefined, SECRET)).toBeNull();
    expect(await constructStripeEvent(body, 'garbage', SECRET)).toBeNull();
    expect(await constructStripeEvent(body, 't=123', SECRET)).toBeNull();
  });
});

describe('POST /v1/webhooks/stripe', () => {
  it('rejects a forged signature with 400', async () => {
    const res = await SELF.fetch('http://localhost/v1/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 't=123,v1=deadbeef', 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a missing signature header with 400', async () => {
    const res = await SELF.fetch('http://localhost/v1/webhooks/stripe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts a correctly signed event with 200', async () => {
    const payload = JSON.stringify({ type: 'invoice.paid', data: { object: {} } });
    const t = Math.floor(Date.now() / 1000);
    const res = await SELF.fetch('http://localhost/v1/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': `t=${t},v1=${await sign(payload, t)}`, 'content-type': 'application/json' },
      body: payload,
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { received: boolean }).toEqual({ received: true });
  });
});

describe('webhook plan sync', () => {
  async function newOrg(fields: Record<string, unknown>): Promise<string> {
    const res = await SELF.fetch('http://localhost/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_name: 'BillBot', org_name: 'BillCo' }),
    });
    const { data } = (await res.json()) as { data: { org_id: string } };
    const org = await env.KV.get<Record<string, unknown>>(`org:${data.org_id}`, 'json');
    await env.KV.put(`org:${data.org_id}`, JSON.stringify({ ...org, ...fields }));
    return data.org_id;
  }

  async function getOrg(orgId: string): Promise<Record<string, unknown>> {
    return (await env.KV.get<Record<string, unknown>>(`org:${orgId}`, 'json'))!;
  }

  async function post(type: string, object: unknown): Promise<number> {
    const payload = JSON.stringify({ type, data: { object } });
    const t = Math.floor(Date.now() / 1000);
    const res = await SELF.fetch('http://localhost/v1/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': `t=${t},v1=${await sign(payload, t)}`, 'content-type': 'application/json' },
      body: payload,
    });
    return res.status;
  }

  async function deliver(type: string, object: unknown): Promise<void> {
    expect(await post(type, object)).toBe(200);
  }

  // What Stripe returns for GET /v1/subscriptions/:id; null makes the lookup fail.
  let liveSub: Record<string, unknown> | null;
  let heldSub: Record<string, unknown> | null;
  beforeEach(() => {
    liveSub = null;
    heldSub = null;
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (...args: Parameters<typeof fetch>) => {
      const req = args[0] instanceof Request ? args[0] : new Request(...args);
      if (!req.url.startsWith('https://api.stripe.com/v1/subscriptions/')) return realFetch(...args);
      if (heldSub && req.url.endsWith('/' + heldSub.id)) return Response.json(heldSub);
      return liveSub ? Response.json(liveSub) : Response.json({ error: { message: 'boom' } }, { status: 500 });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sub(id: string, orgId: string, status: string, price: string, quantity = 1) {
    return { id, status, metadata: { org_id: orgId }, items: { data: [{ price: { id: price }, quantity }] } };
  }

  it('records the subscription quantity as the org seat count, and follows seat changes', async () => {
    const orgId = await newOrg({ plan: 'trial' });
    liveSub = sub('sub_seats', orgId, 'active', 'price_test_team', 4);
    await deliver('checkout.session.completed', { metadata: { org_id: orgId, plan: 'team' }, subscription: 'sub_seats' });
    expect(await getOrg(orgId)).toMatchObject({ plan: 'team', seats: 4 });
    liveSub = sub('sub_seats', orgId, 'active', 'price_test_team', 9);
    await deliver('customer.subscription.updated', liveSub);
    expect((await getOrg(orgId)).seats).toBe(9);
  });

  it('checkout.session.completed sets the plan and subscription id from the live subscription', async () => {
    const orgId = await newOrg({ plan: 'trial' });
    liveSub = sub('sub_1', orgId, 'active', 'price_test_pro');
    await deliver('checkout.session.completed', { metadata: { org_id: orgId, plan: 'pro' }, subscription: 'sub_1' });
    const org = await getOrg(orgId);
    expect(org.plan).toBe('pro');
    expect(org.stripe_subscription_id).toBe('sub_1');
  });

  it('a late checkout.session.completed for an already cancelled subscription leaves the org on trial', async () => {
    const orgId = await newOrg({ plan: 'trial' });
    await deliver('customer.subscription.deleted', sub('sub_late', orgId, 'canceled', 'price_test_pro'));
    liveSub = sub('sub_late', orgId, 'canceled', 'price_test_pro');
    await deliver('checkout.session.completed', { metadata: { org_id: orgId, plan: 'pro' }, subscription: 'sub_late' });
    const org = await getOrg(orgId);
    expect(org.plan).toBe('trial');
    expect(org.stripe_subscription_id).toBeUndefined();
  });

  it('a checkout whose first payment is still pending records the subscription, and its activation grants the plan', async () => {
    const orgId = await newOrg({ plan: 'trial' });
    liveSub = sub('sub_pending', orgId, 'incomplete', 'price_test_team');
    await deliver('checkout.session.completed', { metadata: { org_id: orgId, plan: 'team' }, subscription: 'sub_pending' });
    expect(await getOrg(orgId)).toMatchObject({ plan: 'trial', stripe_subscription_id: 'sub_pending' });
    liveSub = sub('sub_pending', orgId, 'active', 'price_test_team');
    await deliver('customer.subscription.updated', liveSub);
    expect((await getOrg(orgId)).plan).toBe('team');
  });

  it('checkout.session.completed fails with a non-2xx when the subscription lookup fails, so Stripe retries', async () => {
    const orgId = await newOrg({ plan: 'trial' });
    expect(await post('checkout.session.completed', { metadata: { org_id: orgId, plan: 'pro' }, subscription: 'sub_x' })).toBe(502);
    expect((await getOrg(orgId)).plan).toBe('trial');
  });

  it('subscription.updated with the Team price moves Pro to Team', async () => {
    const orgId = await newOrg({ plan: 'pro', stripe_subscription_id: 'sub_2' });
    liveSub = sub('sub_2', orgId, 'active', 'price_test_team');
    await deliver('customer.subscription.updated', sub('sub_2', orgId, 'active', 'price_test_team'));
    expect((await getOrg(orgId)).plan).toBe('team');
  });

  it('subscription.updated with status canceled resets to trial', async () => {
    const orgId = await newOrg({ plan: 'team', stripe_subscription_id: 'sub_3' });
    liveSub = sub('sub_3', orgId, 'canceled', 'price_test_team');
    await deliver('customer.subscription.updated', sub('sub_3', orgId, 'canceled', 'price_test_team'));
    expect((await getOrg(orgId)).plan).toBe('trial');
  });

  it('subscription.updated with past_due or an unknown price leaves the plan alone', async () => {
    const orgId = await newOrg({ plan: 'pro', stripe_subscription_id: 'sub_4' });
    liveSub = sub('sub_4', orgId, 'past_due', 'price_test_team');
    await deliver('customer.subscription.updated', sub('sub_4', orgId, 'past_due', 'price_test_team'));
    liveSub = sub('sub_4', orgId, 'active', 'price_unknown');
    await deliver('customer.subscription.updated', sub('sub_4', orgId, 'active', 'price_unknown'));
    expect((await getOrg(orgId)).plan).toBe('pro');
  });

  it('subscription.deleted resets to trial and clears the subscription id', async () => {
    const orgId = await newOrg({ plan: 'pro', stripe_subscription_id: 'sub_5' });
    liveSub = sub('sub_5', orgId, 'canceled', 'price_test_pro');
    await deliver('customer.subscription.deleted', sub('sub_5', orgId, 'canceled', 'price_test_pro'));
    const org = await getOrg(orgId);
    expect(org.plan).toBe('trial');
    expect(org.stripe_subscription_id).toBeUndefined();
  });

  it('a retried stale event cannot override the subscription\'s current state', async () => {
    const orgId = await newOrg({ plan: 'pro', stripe_subscription_id: 'sub_6' });
    liveSub = sub('sub_6', orgId, 'active', 'price_test_pro');
    await deliver('customer.subscription.updated', sub('sub_6', orgId, 'unpaid', 'price_test_pro'));
    await deliver('customer.subscription.updated', sub('sub_6', orgId, 'active', 'price_test_team'));
    const org = await getOrg(orgId);
    expect(org.plan).toBe('pro');
    expect(org.stripe_subscription_id).toBe('sub_6');
  });

  it('unpaid drops to trial but keeps the subscription so a later payment restores the plan', async () => {
    const orgId = await newOrg({ plan: 'team', stripe_subscription_id: 'sub_7' });
    liveSub = sub('sub_7', orgId, 'unpaid', 'price_test_team');
    await deliver('customer.subscription.updated', liveSub);
    expect(await getOrg(orgId)).toMatchObject({ plan: 'trial', stripe_subscription_id: 'sub_7' });
    liveSub = sub('sub_7', orgId, 'active', 'price_test_team');
    await deliver('customer.subscription.updated', liveSub);
    expect((await getOrg(orgId)).plan).toBe('team');
  });

  it('keeps a paying subscription when a different legacy checkout is incomplete and then expires', async () => {
    const orgId = await newOrg({ plan: 'team', stripe_subscription_id: 'sub_paid' });
    heldSub = sub('sub_paid', orgId, 'active', 'price_test_team');
    liveSub = sub('sub_pending', orgId, 'incomplete', 'price_test_pro');
    await deliver('checkout.session.completed', { metadata: { org_id: orgId }, subscription: 'sub_pending' });
    liveSub = sub('sub_pending', orgId, 'incomplete_expired', 'price_test_pro');
    await deliver('customer.subscription.updated', liveSub);
    expect(await getOrg(orgId)).toMatchObject({ plan: 'team', stripe_subscription_id: 'sub_paid' });

    heldSub = sub('sub_paid', orgId, 'canceled', 'price_test_team');
    liveSub = sub('sub_new', orgId, 'active', 'price_test_pro');
    await deliver('checkout.session.completed', { metadata: { org_id: orgId }, subscription: 'sub_new' });
    expect(await getOrg(orgId)).toMatchObject({ plan: 'pro', stripe_subscription_id: 'sub_new' });
  });

  it('ignores subscription events for a subscription the org no longer holds', async () => {
    const orgId = await newOrg({ plan: 'team', stripe_subscription_id: 'sub_new' });
    await deliver('customer.subscription.updated', sub('sub_old', orgId, 'active', 'price_test_pro'));
    await deliver('customer.subscription.deleted', sub('sub_old', orgId, 'canceled', 'price_test_pro'));
    const org = await getOrg(orgId);
    expect(org.plan).toBe('team');
    expect(org.stripe_subscription_id).toBe('sub_new');
  });
});
