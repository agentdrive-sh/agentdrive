import type { PaidPlan } from '@agentdrive/shared';
import type { Env } from '../env.js';

export function priceIds(env: Env): Record<PaidPlan, string | undefined> {
  return { pro: env.STRIPE_PRICE_PRO, team: env.STRIPE_PRICE_TEAM };
}

export class StripeError extends Error {
  constructor(readonly status: number, readonly type?: string) {
    super(`Stripe request failed (${status})`);
  }
}

export async function stripeRequest<T>(env: Env, path: string, form?: Record<string, string>, key?: string): Promise<T> {
  const headers = new Headers({ Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` });
  if (form) headers.set('Content-Type', 'application/x-www-form-urlencoded');
  if (key) headers.set('Idempotency-Key', key);
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: form ? 'POST' : 'GET',
    headers,
    body: form && new URLSearchParams(form),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = await res.json<{ error?: { type?: string } }>().catch(() => null);
    throw new StripeError(res.status, body?.error?.type);
  }
  return res.json() as Promise<T>;
}

// Charge units follow Stripe's invoice API. In particular ISK and UGX
// arrive in hundredths even though display formatters use whole units.
const zeroDecimal = new Set('bif clp djf gnf jpy kmf krw mga pyg rwf vnd vuv xaf xof xpf'.split(' '));
const threeDecimal = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);

export function invoiceAmount(minor: number, currency: string): number {
  const code = currency.toLowerCase();
  if (zeroDecimal.has(code)) return minor;
  return minor / (threeDecimal.has(code) ? 1000 : 100);
}
