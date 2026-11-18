import { DurableObject } from 'cloudflare:workers';
import type { OrgMeta, PaidPlan } from '@agentdrive/shared';
import type { Env } from '../env.js';
import { StorageService } from '../services/storage.js';
import { priceIds, StripeError, stripeRequest } from '../services/stripe.js';

interface Session {
  id: string;
  url: string | null;
  status?: string;
  metadata?: Record<string, string>;
}
interface Attempt {
  createdAt: number;
  key: string;
  form: Record<string, string>;
}
type CheckoutResult = { success: true; data: { session_id: string; checkout_url: string } }
  | { success: false; status: 404 | 409 | 502; error: string };
const bills = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']);

export function orgBilling(env: Env, orgId: string) {
  return env.BILLING_COORDINATOR.get(env.BILLING_COORDINATOR.idFromName(orgId));
}

// Checkout and webhook deliveries for one organization share a single queue.
// A persisted idempotency key covers eviction after Stripe accepts a request
// but before its response reaches this object.
export class BillingCoordinator extends DurableObject<Env> {
  private tail: Promise<void> = Promise.resolve();

  private async serialized<T>(run: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await run(); } finally { release(); }
  }

  checkout(orgId: string, plan: PaidPlan, quantity: number, price: string): Promise<CheckoutResult> {
    return this.serialized(async () => {
      try {
        return await this.openCheckout(orgId, plan, quantity, price);
      } catch {
        return { success: false, status: 502, error: 'Stripe checkout is temporarily unavailable' };
      }
    });
  }

  private async createSession(attempt: Attempt): Promise<Session> {
    let session: Session;
    try {
      session = await stripeRequest<Session>(this.env, 'checkout/sessions', attempt.form, attempt.key);
    } catch (error) {
      // A rejected form created no session. A corrected price or seat count
      // should be usable immediately. Keep ambiguous attempts for replay.
      if (error instanceof StripeError && error.status === 400 && error.type === 'invalid_request_error') {
        await this.ctx.storage.delete('attempt');
      }
      throw error;
    }
    if (!session.id || !session.url) throw new Error('Stripe returned an incomplete Checkout Session');
    await this.ctx.storage.put('session', session.id);
    await this.ctx.storage.delete('attempt');
    return session;
  }

  private async openCheckout(orgId: string, plan: PaidPlan, quantity: number, price: string): Promise<CheckoutResult> {
    const store = new StorageService(this.env.KV, this.env.R2);
    const org = await store.getOrg(orgId);
    if (!org) return { success: false, status: 404, error: 'Organization not found' };
    const savedCustomer = await this.ctx.storage.get<string>('customer');
    let customer = savedCustomer || org.stripe_customer_id;
    if (savedCustomer === undefined) await this.ctx.storage.put('customer', customer ?? '');
    if (!customer) {
      const created = await stripeRequest<{ id: string }>(this.env, 'customers', {
        'metadata[org_id]': orgId, name: org.name,
      }, `customer-${orgId}`);
      customer = created.id;
      await this.ctx.storage.put('customer', customer);
    }
    if (customer !== org.stripe_customer_id) await store.updateOrg(orgId, { stripe_customer_id: customer });
    const customerQuery = `customer=${encodeURIComponent(customer)}&limit=100`;

    const pending = await this.ctx.storage.get<Attempt>('attempt');
    let foundPending = false;
    let match: Session | undefined;
    const previous = await this.ctx.storage.get<string>('session');
    const handle = async (session: Session) => {
      const meta = session.metadata;
      if (pending && meta?.attempt === pending.key) foundPending = true;
      if (!match && session.url && meta?.org_id === orgId && meta.price === price && meta.seats === String(quantity)) {
        match = session;
      } else {
        await stripeRequest(this.env, `checkout/sessions/${encodeURIComponent(session.id)}/expire`, {});
      }
    };
    if (previous) {
      const session = await stripeRequest<Session>(this.env, `checkout/sessions/${encodeURIComponent(previous)}`);
      if (session.status === 'open') await handle(session);
    }
    // Legacy open sessions predate the coordinator. Close conflicting sessions
    // before checking subscriptions, so a payment racing expiration is seen.
    for await (const session of this.list<Session>('checkout/sessions', customerQuery + '&status=open')) {
      if (session.id !== previous) await handle(session);
    }
    for await (const sub of this.list<{ id: string; status: string }>('subscriptions', customerQuery)) {
      if (bills.has(sub.status)) {
        if (match) await stripeRequest(this.env, `checkout/sessions/${encodeURIComponent(match.id)}/expire`, {});
        if (pending) await this.ctx.storage.delete('attempt');
        return { success: false, status: 409, error: 'Already subscribed; manage your plan in the billing portal' };
      }
    }
    if (pending) {
      // Stripe may cache a 500 even when the operation succeeded. Its open
      // sessions and live subscriptions get the first say on ambiguous retries.
      if (!foundPending && Date.now() - pending.createdAt < 86_400_000) {
        await this.createSession(pending);
        // The replay returns Stripe's original creation response. Recheck
        // the session's current state before returning its URL or replacing it.
        return this.openCheckout(orgId, plan, quantity, price);
      }
      // Checkout Sessions expire within 24 hours. After that the old key
      // might have been pruned, so start a new intent only after reconciliation.
      await this.ctx.storage.delete('attempt');
    }
    if (!match) {
      const key = crypto.randomUUID();
      const form = {
        customer, mode: 'subscription', 'line_items[0][price]': price,
        'line_items[0][quantity]': String(quantity),
        success_url: `${this.env.SITE_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${this.env.SITE_URL}/billing/cancel`,
        'metadata[org_id]': orgId, 'metadata[plan]': plan,
        'metadata[price]': price, 'metadata[seats]': String(quantity), 'metadata[attempt]': key,
        'subscription_data[metadata][org_id]': orgId,
        'subscription_data[metadata][plan]': plan,
        'subscription_data[metadata][seats]': String(quantity),
        allow_promotion_codes: 'true', billing_address_collection: 'required',
      };
      const attempt = { key, createdAt: Date.now(), form };
      await this.ctx.storage.put('attempt', attempt);
      match = await this.createSession(attempt);
    }
    return { success: true, data: { session_id: match.id, checkout_url: match.url! } };
  }

  private async *list<T extends { id: string }>(path: string, query: string): AsyncGenerator<T> {
    let cursor = '';
    do {
      const page: { data: T[]; has_more?: boolean } = await stripeRequest(this.env, `${path}?${query}${cursor}`);
      yield* page.data;
      if (!page.has_more) return;
      const last = page.data.at(-1);
      if (!last) throw new Error('Empty Stripe page with more results');
      cursor = `&starting_after=${encodeURIComponent(last.id)}`;
    } while (cursor);
  }

  reconcile(orgId: string, subId: string, fromCheckout: boolean): Promise<boolean> {
    return this.serialized(async () => {
      try {
        await this.syncSubscription(orgId, subId, fromCheckout);
        return true;
      } catch {
        return false;
      }
    });
  }

  private async syncSubscription(orgId: string, subId: string, fromCheckout: boolean): Promise<void> {
    const store = new StorageService(this.env.KV, this.env.R2);
    const org = await store.getOrg(orgId);
    if (!org) return;
    const saved = await this.ctx.storage.get<string>('subscription');
    const current = saved ?? org.stripe_subscription_id;
    if (saved === undefined) await this.ctx.storage.put('subscription', current ?? '');
    if (!fromCheckout && current !== subId) return;
    const sub = await stripeRequest<{
      id: string; status: string; customer?: string; metadata?: { org_id?: string };
      items?: { data: Array<{ price?: { id?: string }; quantity?: number }> };
    }>(this.env, `subscriptions/${encodeURIComponent(subId)}`);
    if (sub.id !== subId || (sub.metadata?.org_id && sub.metadata.org_id !== orgId)
      || (sub.customer && org.stripe_customer_id && sub.customer !== org.stripe_customer_id)) return;
    // A late completion from a second, legacy checkout must not displace
    // the subscription that still bills this organization. Its cancellation
    // could otherwise downgrade a customer who is paying on the original.
    if (fromCheckout && current && current !== subId) {
      const held = await stripeRequest<{ id: string; status: string }>(this.env, `subscriptions/${encodeURIComponent(current)}`);
      if (held.id !== current || bills.has(held.status)) return;
    }
    const item = sub.items?.data[0];
    const plan = (Object.entries(priceIds(this.env)) as [PaidPlan, string | undefined][])
      .find(([, id]) => id && id === item?.price?.id)?.[0];
    let fields: Partial<OrgMeta>;
    if (plan && (sub.status === 'active' || sub.status === 'trialing')) {
      fields = { plan, stripe_subscription_id: subId, seats: item?.quantity };
    } else if (fromCheckout && sub.status === 'incomplete') {
      fields = { stripe_subscription_id: subId };
    } else if (current === subId && (sub.status === 'canceled' || sub.status === 'incomplete_expired')) {
      fields = { plan: 'trial', stripe_subscription_id: undefined };
    } else if (current === subId && sub.status === 'unpaid') {
      fields = { plan: 'trial', stripe_subscription_id: subId };
    } else return;
    await store.updateOrg(orgId, fields);
    await this.ctx.storage.put('subscription', fields.stripe_subscription_id ?? '');
  }
}
