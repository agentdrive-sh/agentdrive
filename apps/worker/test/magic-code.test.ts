import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import worker from '../src/index';
import type { Env } from '../src/env';

// A 6-digit code is only safe while guesses at one email stay few. The MagicCodes Durable
// Object owns each address's code, so the counts below must hold under concurrency too.

async function clearKv(): Promise<void> {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

let mail: string[] = [];
let mailFails = false;
const SEND_EMAIL = {
  send: async (message: { text: string }) => {
    if (mailFails) throw new Error('E_DELIVERY_FAILED');
    mail.push(message.text);
  },
} as unknown as SendEmail;

beforeEach(async () => {
  await clearKv();
  mail = [];
  mailFails = false;
});

// Called directly rather than through SELF, whose per-request cost grows over a suite run.
let ipSeq = 0;
async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  ipSeq += 1;
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`http://localhost/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': `10.7.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`, ...headers },
    body: JSON.stringify(body),
  }), { ...(env as unknown as Env), SEND_EMAIL }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const lastCode = () => /\b(\d{6})\b/.exec(mail.at(-1) ?? '')![1]!;

async function sendCode(email: string): Promise<string> {
  expect((await post('/auth/send-code', { email })).status).toBe(200);
  return lastCode();
}

const verify = (email: string, code: string) => post('/auth/verify-code', { email, code });
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

async function expectTooMany(res: Response, code: string, retryAfter?: number): Promise<string> {
  expect(res.status).toBe(429);
  const seconds = Number(res.headers.get('Retry-After'));
  expect(seconds).toBeGreaterThan(0);
  if (retryAfter !== undefined) expect(seconds).toBe(retryAfter);
  const body = (await res.json()) as { code: string; error: string };
  expect(body.code).toBe(code);
  return body.error;
}

describe('magic-code sign-in', () => {
  it('counts 20 concurrent wrong guesses one by one: the fifth locks, and the right code then fails', async () => {
    const code = await sendCode('victim@example.com');
    const statuses = await Promise.all(Array.from({ length: 20 }, () => verify('victim@example.com', wrong(code)).then((r) => r.status)));
    expect(statuses.filter((s) => s === 401)).toHaveLength(4);
    expect(statuses.filter((s) => s === 429)).toHaveLength(16);
    await expectTooMany(await verify('victim@example.com', code), 'too_many_attempts');
  });

  it('locks with 429 too_many_attempts and Retry-After, names the other ways in, and refuses new codes until it lifts', async () => {
    const code = await sendCode('bob@example.com');
    for (const email of ['bob@example.com', 'Bob@example.com', 'BOB@EXAMPLE.COM', 'bob@Example.com']) {
      expect((await verify(email, wrong(code))).status).toBe(401);
    }
    const error = await expectTooMany(await verify('bOb@example.com', wrong(code)), 'too_many_attempts', 900);
    expect(error).toContain('15 minutes');
    await expectTooMany(await verify('bob@example.com', code), 'too_many_attempts');
    await expectTooMany(await post('/auth/send-code', { email: 'bob@example.com' }), 'too_many_attempts');

    const oauth = { ...(env as unknown as Env), SEND_EMAIL, GOOGLE_OAUTH_CLIENT_ID: 'g', GITHUB_OAUTH_CLIENT_ID: 'h' };
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request('http://localhost/v1/auth/verify-code', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bob@example.com', code }),
    }), oauth, ctx);
    expect(await expectTooMany(res, 'too_many_attempts')).toMatch(/Sign in with Google or GitHub, or try again in 15 minutes/);

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 16 * 60_000);
      expect((await verify('bob@example.com', await sendCode('bob@example.com'))).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resends the live code instead of replacing it', async () => {
    const first = await sendCode('carol@example.com');
    expect(await sendCode('carol@example.com')).toBe(first);
    expect((await verify('carol@example.com', first)).status).toBe(200);
  });

  it('restarts the expiry on a resend, so the code lasts the ten minutes the new email states', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const first = await sendCode('erin@example.com');
      vi.setSystemTime(Date.now() + 9 * 60_000);
      expect(await sendCode('erin@example.com')).toBe(first);
      vi.setSystemTime(Date.now() + 9 * 60_000);
      expect((await verify('erin@example.com', first)).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it('carries the latest request\'s purpose and context when a live code is reused', async () => {
    const ns = (env as unknown as Env).MAGIC_CODES;
    const codes = ns.get(ns.idFromName('frank@example.com'));
    const first = await codes.issue('login');
    const second = await codes.issue('verify', { workspace_id: 'ws_2', token_id: 'tok_2' });
    expect(first.status === 'issued' && second.status === 'issued' && second.code === first.code).toBe(true);
    if (second.status !== 'issued') return;
    await codes.delivered(second.code);
    expect(await codes.verify(second.code)).toEqual({ status: 'ok', purpose: 'verify', context: { workspace_id: 'ws_2', token_id: 'tok_2' } });
  });

  it('clears an address\'s state once its code, lock and send window have all lapsed', async () => {
    const ns = (env as unknown as Env).MAGIC_CODES;
    const codes = ns.get(ns.idFromName('gina@example.com'));
    await codes.issue('login');
    const stored = () => runInDurableObject(codes, (_obj, state) => state.storage.get('state'));
    expect(await runDurableObjectAlarm(codes)).toBe(true);
    expect(await stored()).toBeDefined();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 61 * 60_000);
      expect(await runDurableObjectAlarm(codes)).toBe(true);
      expect(await stored()).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the delivered code working when a later send fails', async () => {
    const code = await sendCode('dave@example.com');
    mailFails = true;
    expect((await post('/auth/send-code', { email: 'dave@example.com' })).status).toBe(502);
    mailFails = false;
    expect((await verify('dave@example.com', code)).status).toBe(200);
  });

  it('never accepts a code whose email failed to go out', async () => {
    mailFails = true;
    expect((await post('/auth/send-code', { email: 'gina@example.com' })).status).toBe(502);
    mailFails = false;
    const resent = await sendCode('gina@example.com');
    expect((await verify('gina@example.com', resent)).status).toBe(200);
  });

  it('sends at most five codes an hour to one address, invites included, then answers 429 with Retry-After', async () => {
    const reg = await post('/register', { agent_name: 'Inviter' });
    const { api_key } = ((await reg.json()) as { data: { api_key: string } }).data;
    for (let i = 0; i < 3; i += 1) expect((await post('/auth/send-code', { email: 'erin@example.com' })).status).toBe(200);
    for (let i = 0; i < 2; i += 1) {
      expect((await post('/org/invite', { email: 'erin@example.com' }, { Authorization: `Bearer ${api_key}` })).status).toBe(201);
    }
    expect(mail).toHaveLength(5);

    expect(await expectTooMany(await post('/auth/send-code', { email: 'Erin@Example.com' }), 'rate_limited')).toContain('Too many codes');
    expect((await post('/org/invite', { email: 'erin@example.com', role: 'member' }, { Authorization: `Bearer ${api_key}` })).status).toBe(201);
    expect(mail).toHaveLength(5);
    expect((await verify('erin@example.com', lastCode())).status).toBe(200);
  });

  it('forgets earlier wrong guesses after a successful sign-in', async () => {
    const code = await sendCode('frank@example.com');
    for (let i = 0; i < 4; i += 1) expect((await verify('frank@example.com', wrong(code))).status).toBe(401);
    expect((await verify('frank@example.com', code)).status).toBe(200);

    const next = await sendCode('frank@example.com');
    expect((await verify('frank@example.com', wrong(next))).status).toBe(401);
    expect((await verify('frank@example.com', next)).status).toBe(200);
  });

  it('accepts a code once, and only for the email it was sent to', async () => {
    const code = await sendCode('hana@example.com');
    expect((await verify('ivan@example.com', code)).status).toBe(401);
    expect((await verify('Hana@Example.com', code)).status).toBe(200);
    expect((await verify('hana@example.com', code)).status).toBe(401);
  });

  it('signs in an invitee with the code their invite sent, then lets them accept it', async () => {
    const reg = await post('/register', { agent_name: 'Team', org_name: 'TeamCo' });
    const { api_key, org_id } = ((await reg.json()) as { data: { api_key: string; org_id: string } }).data;
    expect((await post('/org/invite', { email: 'newbie@example.com' }, { Authorization: `Bearer ${api_key}` })).status).toBe(201);
    const signedIn = await verify('newbie@example.com', lastCode());
    expect(signedIn.status).toBe(200);
    const { session_id } = ((await signedIn.json()) as { data: { session_id: string } }).data;
    expect((await post(`/org/invites/${org_id}/accept`, {}, { 'X-Session-Token': session_id })).status).toBe(200);
  });

  it('keeps no sign-in codes in KV', async () => {
    await sendCode('kv@example.com');
    expect((await env.KV.list({ prefix: 'magic' })).keys).toEqual([]);
  });
});
