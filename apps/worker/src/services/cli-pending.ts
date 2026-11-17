import { generateId, hashContent } from '@agentdrive/shared';
import type { CliPendingRecord } from '@agentdrive/shared';
import type { Env } from '../env.js';

const CLI_PENDING_TTL_SECONDS = 600;
export const MAX_CODE_ATTEMPTS = 5;
// No 0/O or 1/I to misread. 32 symbols, so each random byte maps to one without bias.
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const kvKey = (id: string) => `cli_pending:${id}`;

export function createPendingId(): string {
  return generateId('cli');
}

function createUserCode(): string {
  const chars = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => USER_CODE_ALPHABET[b % 32]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

// People type the code in either case, with or without the dash.
function userCodeHash(id: string, code: string): Promise<string> {
  return hashContent(`${id}:${code.toUpperCase().replace(/[^A-Z0-9]/g, '')}`);
}

function sameHash(a: string | undefined, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a ?? '');
  const y = enc.encode(b);
  return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y);
}

async function save(env: Env, record: CliPendingRecord): Promise<void> {
  // KV refuses a TTL under 60 seconds.
  const ttl = Math.max(60, record.expires_at - Math.floor(Date.now() / 1000));
  await env.KV.put(kvKey(record.id), JSON.stringify(record), { expirationTtl: ttl });
}

export async function createPending(env: Env, id: string): Promise<{ userCode: string; deviceCode: string }> {
  const now = Math.floor(Date.now() / 1000);
  const userCode = createUserCode();
  const deviceCode = `${generateId()}${generateId()}`;
  await save(env, {
    id,
    status: 'pending',
    created_at: now,
    expires_at: now + CLI_PENDING_TTL_SECONDS,
    user_code_hash: await userCodeHash(id, userCode),
    device_code_hash: await hashContent(deviceCode),
    failed_attempts: 0,
  });
  return { userCode, deviceCode };
}

export async function getPending(env: Env, id: string): Promise<CliPendingRecord | null> {
  const record = await env.KV.get<CliPendingRecord>(kvKey(id), 'json');
  if (!record) return null;
  if (record.status === 'pending' && record.expires_at < Math.floor(Date.now() / 1000)) {
    return { ...record, status: 'expired' };
  }
  return record;
}

// shortcut: KV has no compare-and-set, so wrong codes sent at the same instant can count once
// between them; 32^8 codes keep that harmless. Move the record to a Durable Object if it matters.
export async function checkUserCode(env: Env, record: CliPendingRecord, code: string): Promise<'ok' | 'wrong' | 'denied'> {
  if (sameHash(record.user_code_hash, await userCodeHash(record.id, code))) return 'ok';
  const failed = record.failed_attempts + 1;
  const denied = failed >= MAX_CODE_ATTEMPTS;
  await save(env, { ...record, failed_attempts: failed, status: denied ? 'denied' : record.status });
  return denied ? 'denied' : 'wrong';
}

// Only the CLI holding the device code reads the record. The first read that returns the key
// cuts the record's life to KV's one-minute minimum, so a poll response lost in transit can
// be retried by that CLI and the key does not linger for the rest of the ten minutes.
export async function pollPending(env: Env, id: string, deviceCode: string): Promise<CliPendingRecord | null> {
  const record = await getPending(env, id);
  if (!record || !sameHash(record.device_code_hash, await hashContent(deviceCode))) return null;
  if (record.status === 'complete' && record.delivered_at === undefined) {
    await env.KV.put(kvKey(id), JSON.stringify({ ...record, delivered_at: Math.floor(Date.now() / 1000) }), { expirationTtl: 60 });
  }
  return record;
}

export async function completePending(
  env: Env,
  id: string,
  payload:
    | { status: 'complete'; agent_id?: string; org_id?: string; email?: string; api_key?: string }
    | { status: 'refused'; error: string; upgrade_url: string },
): Promise<CliPendingRecord | null> {
  const existing = await getPending(env, id);
  if (!existing) return null;
  if (existing.status !== 'pending') return existing;

  const updated: CliPendingRecord = { ...existing, ...payload };
  await save(env, updated);
  return updated;
}

export const CLI_PENDING_TTL = CLI_PENDING_TTL_SECONDS;
