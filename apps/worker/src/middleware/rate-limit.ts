import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Env, AuthContext } from '../env.js';

type Kind = 'principal' | 'search' | 'ip_register' | 'ip_magic';
type LimiterBinding = 'RL_PRINCIPAL' | 'RL_SEARCH' | 'RL_REGISTER' | 'RL_MAGIC';

// Limits live in [[ratelimits]] in wrangler.toml. The binding answers only yes
// or no, so the configured period is the honest Retry-After.
const LIMITERS: Record<Kind, { binding: LimiterBinding; period: number }> = {
  principal: { binding: 'RL_PRINCIPAL', period: 10 },
  search: { binding: 'RL_SEARCH', period: 10 },
  ip_register: { binding: 'RL_REGISTER', period: 60 },
  ip_magic: { binding: 'RL_MAGIC', period: 60 },
};

// Fails open: a limiter outage must not take the API down with it.
async function allowed(env: Env, kind: Kind, key: string): Promise<boolean> {
  try {
    const binding = env[LIMITERS[kind].binding];
    if (!binding) throw new Error(`${LIMITERS[kind].binding} is not bound`);
    return (await binding.limit({ key })).success;
  } catch (err) {
    console.error(JSON.stringify({ event: 'rate_limit_error', kind }), err);
    return true;
  }
}

function limited(c: Context, kind: Kind, principalType: string): Response {
  const seconds = LIMITERS[kind].period;
  console.log(JSON.stringify({ event: 'rate_limited', kind, principal_type: principalType }));
  c.header('Retry-After', String(seconds));
  return c.json({ success: false, code: 'rate_limited', error: `Rate limited; try again in ${seconds} seconds` }, 429);
}

function principalKey(auth: AuthContext): string {
  if (auth.type === 'agent') return `agent:${auth.agent_id}`;
  if (auth.type === 'share') return `share:${auth.token_id}`;
  return `session:${auth.session_id}`;
}

// The 429 to send for this principal, or null to go on.
export async function principalRateLimit<E extends { Bindings: Env }>(c: Context<E>, auth: AuthContext): Promise<Response | null> {
  return (await allowed(c.env, 'principal', principalKey(auth))) ? null : limited(c, 'principal', auth.type);
}

// Mount after flexAuth.
export const searchRateLimit = createMiddleware<{ Bindings: Env; Variables: { auth: AuthContext } }>(async (c, next) => {
  const auth = c.get('auth');
  if (!(await allowed(c.env, 'search', principalKey(auth)))) return limited(c, 'search', auth.type);
  await next();
});

// For unauthenticated endpoints, where no principal exists yet. A scope gives a route its own
// count on the tier's binding instead of sharing the per-IP one.
export const ipRateLimit = (tier: 'ip_register' | 'ip_magic', scope?: string) =>
  createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
    if (!(await allowed(c.env, tier, scope ? `${scope}:${ip}` : ip))) return limited(c, tier, 'ip');
    await next();
  });
