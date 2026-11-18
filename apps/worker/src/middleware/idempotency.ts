import type { Context } from 'hono';
import type { Env, AuthContext } from '../env.js';
import { idempotencyRecord } from '../durable-objects/idempotency.js';
import { principalKey } from './rate-limit.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);

// POST routes that only read: a retry is already safe, and a replay would hand back stale results.
// Search and context only read. Logout ends the session it authenticates with, so a retry is
// refused with 401 before any replay could happen; repeating a logout is harmless anyway.
// Creating an API key or a share link, and opening the billing portal, answer with a secret
// (the key, the share token, a portal login link) that AgentDrive never keeps in clear.
// Patterns match both concrete paths and the spec's {param} templates.
const IDEMPOTENCY_EXCLUDED = [
  /^\/v1\/search$/,
  /^\/v1\/context$/,
  /^\/v1\/auth\/logout$/,
  /^\/v1\/keys$/,
  /^\/v1\/workspaces\/[^/]+\/share$/,
  /^\/v1\/billing\/portal$/,
];

// Sub-apps mounted under one prefix each run flexAuth, so a path no handler matches can pass
// through it twice; the first pass owns the key.
const claimedRequests = new WeakSet<Request>();

// Above this the response is not kept: the key stays spent and a retry answers 409
// idempotency_response_not_stored instead of running the write again.
export const MAX_STORED_RESPONSE_BYTES = 1024 * 1024;

const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;

// Refusals that mean nothing ran, and server errors, free the key for a retry.
const releases = (status: number) => status >= 500 || status === 401 || status === 403 || status === 404 || status === 429;

// Streams the body into the hash so a large upload is not held in memory several times over.
export async function fingerprint(req: Request): Promise<string> {
  const { pathname, search } = new URL(req.url);
  const hash = new crypto.DigestStream('SHA-256');
  const writer = hash.getWriter();
  await writer.write(new TextEncoder().encode(`${req.method} ${pathname}${search}\n`));
  const body = req.clone().body;
  if (body) {
    const reader = body.getReader();
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) await writer.write(chunk.value);
  }
  await writer.close();
  return [...new Uint8Array(await hash.digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function supportsIdempotency(method: string, path: string): boolean {
  return WRITE_METHODS.has(method.toUpperCase()) && !IDEMPOTENCY_EXCLUDED.some((route) => route.test(path));
}

// Runs an authenticated, rate-limit-admitted request under its Idempotency-Key, if it sent one
// (draft-ietf-httpapi-idempotency-key-header). run is the rest of the chain.
export async function idempotent<E extends { Bindings: Env }>(
  c: Context<E>,
  auth: AuthContext,
  run: () => Promise<void>,
): Promise<Response | void> {
  const key = c.req.header('Idempotency-Key');
  if (key === undefined || claimedRequests.has(c.req.raw) || !supportsIdempotency(c.req.method, c.req.path)) return run();
  if (!KEY_PATTERN.test(key)) {
    return c.json({ success: false, code: 'invalid_idempotency_key', error: 'Idempotency-Key must be 1 to 255 visible ASCII characters' }, 400);
  }

  claimedRequests.add(c.req.raw);
  const record = idempotencyRecord(c.env, principalKey(auth), key);
  const claim = await record.claim(await fingerprint(c.req.raw));
  switch (claim.outcome) {
    case 'mismatch':
      return c.json({ success: false, code: 'idempotency_key_reused', error: 'This Idempotency-Key was already used for a different request' }, 422);
    case 'in_flight':
      return c.json({ success: false, code: 'idempotency_key_in_use', error: 'A request with this Idempotency-Key is still being processed; retry once it finishes' }, 409);
    case 'not_stored':
      return c.json({
        success: false,
        code: 'idempotency_response_not_stored',
        error: `The request with this Idempotency-Key already ran and answered ${claim.status}, but its response was too large to keep; read the resource instead of retrying`,
      }, 409);
    case 'replay':
      return new Response(claim.body, {
        status: claim.status,
        headers: { ...(claim.contentType ? { 'Content-Type': claim.contentType } : {}), 'Idempotent-Replayed': 'true' },
      });
  }

  try {
    await run();
  } catch (err) {
    await record.release(claim.token);
    throw err;
  }
  const res = c.res;
  if (releases(res.status)) {
    await record.release(claim.token);
    return;
  }
  const body = await res.clone().arrayBuffer();
  try {
    await record.complete(claim.token, res.status, res.headers.get('Content-Type'), body.byteLength <= MAX_STORED_RESPONSE_BYTES ? body : null);
  } catch (err) {
    // The write already happened, so its response still goes out; a retry within the lease answers 409.
    console.error(JSON.stringify({ event: 'idempotency_store_failed', status: res.status }), err);
  }
}
