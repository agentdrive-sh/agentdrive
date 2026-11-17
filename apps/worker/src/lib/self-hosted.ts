import type { Env } from '../env.js';

// Only the exact string switches limits off, so a typo or a stray value in
// production keeps every limit in place.
export function selfHosted(env: Pick<Env, 'SELF_HOSTED'>): boolean {
  return env.SELF_HOSTED === 'true';
}

// The only org a self-hosted instance ever has. A fixed id keeps a second one from
// appearing even when a KV read lags a write.
export const SELF_HOSTED_ORG_ID = 'org_selfhosted';

export const REGISTRATION_CLOSED = {
  success: false,
  code: 'registration_closed',
  error: 'Registration is closed on this self-hosted instance; ask its operator for an API key',
} as const;

// On a self-hosted instance only the operator registers, with the one-time token
// `pnpm selfhost` sets for the request and deletes right after. Unset means closed.
export function bootstrapAllowed(env: Pick<Env, 'SELF_HOSTED_BOOTSTRAP_TOKEN'>, sent: string | undefined): boolean {
  const token = env.SELF_HOSTED_BOOTSTRAP_TOKEN;
  if (!token || !sent) return false;
  const enc = new TextEncoder();
  const [a, b] = [enc.encode(sent), enc.encode(token)];
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}
