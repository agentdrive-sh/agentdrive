import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env.js';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
// A claim whose request never finished, because the isolate died mid-handler, frees
// after this instead of answering 409 for a day. It outlasts any write handler.
export const IDEMPOTENCY_LEASE_MS = 5 * 60 * 1000;

export type Claim =
  | { outcome: 'claimed'; token: string }
  | { outcome: 'in_flight' }
  | { outcome: 'mismatch' }
  | { outcome: 'not_stored'; status: number }
  | { outcome: 'replay'; status: number; contentType: string | null; body: ArrayBuffer };

type Entry = {
  fingerprint: string;
  token: string;
  status: number | null;
  content_type: string | null;
  body: ArrayBuffer | null;
  lease_until: number;
  expires: number;
};

export function idempotencyRecord(env: Env, principal: string, key: string) {
  return env.IDEMPOTENCY.get(env.IDEMPOTENCY.idFromName(`${principal}\n${key}`));
}

// One per (principal, Idempotency-Key). Each method reads and writes SQLite without
// awaiting in between, so two concurrent claims cannot both win.
export class IdempotencyRecord extends DurableObject<Env> {
  private readonly sql = this.ctx.storage.sql;

  // Created on each call rather than in the constructor: the expiry alarm drops the whole
  // database, and the same instance may take the key's next claim.
  private entry(): Entry | undefined {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS entry (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      fingerprint TEXT NOT NULL,
      token TEXT NOT NULL,
      status INTEGER,
      content_type TEXT,
      body BLOB,
      lease_until INTEGER NOT NULL,
      expires INTEGER NOT NULL
    )`);
    return this.sql.exec<Entry>('SELECT * FROM entry WHERE id = 1').toArray()[0];
  }

  async claim(fingerprint: string): Promise<Claim> {
    const now = Date.now();
    const entry = this.entry();
    const live = entry && entry.expires > now && (entry.status !== null || entry.lease_until > now);
    if (live) {
      if (entry.fingerprint !== fingerprint) return { outcome: 'mismatch' };
      if (entry.status === null) return { outcome: 'in_flight' };
      if (entry.body === null) return { outcome: 'not_stored', status: entry.status };
      return { outcome: 'replay', status: entry.status, contentType: entry.content_type, body: entry.body };
    }
    const token = crypto.randomUUID();
    const expires = now + IDEMPOTENCY_TTL_MS;
    this.sql.exec(
      'INSERT OR REPLACE INTO entry (id, fingerprint, token, status, content_type, body, lease_until, expires) VALUES (1, ?, ?, NULL, NULL, NULL, ?, ?)',
      fingerprint, token, now + IDEMPOTENCY_LEASE_MS, expires,
    );
    await this.ctx.storage.setAlarm(expires);
    return { outcome: 'claimed', token };
  }

  // body null records that the response ran but was too large to keep.
  async complete(token: string, status: number, contentType: string | null, body: ArrayBuffer | null): Promise<void> {
    if (!this.entry()) return;
    const expires = Date.now() + IDEMPOTENCY_TTL_MS;
    const updated = this.sql.exec(
      'UPDATE entry SET status = ?, content_type = ?, body = ?, expires = ? WHERE id = 1 AND token = ? AND status IS NULL',
      status, contentType, body, expires, token,
    ).rowsWritten;
    if (updated) await this.ctx.storage.setAlarm(expires);
  }

  release(token: string): void {
    if (!this.entry()) return;
    this.sql.exec('DELETE FROM entry WHERE id = 1 AND token = ? AND status IS NULL', token);
  }

  async alarm(): Promise<void> {
    const entry = this.entry();
    if (entry && entry.expires > Date.now()) await this.ctx.storage.setAlarm(entry.expires);
    else await this.ctx.storage.deleteAll();
  }
}
