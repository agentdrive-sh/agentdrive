import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env.js';
import { RESUME_MARKER_TTL_SECONDS } from '../services/storage.js';

interface State { total: number; cursor: string | null }
type Outcome = 'counted' | 'repeat' | 'refused';

export function monthlyMeter(env: Env, org: string, month: string) {
  const prefix = `xresume_m:${org}:${month}:`;
  const name = `${env.RESUME_METER_EPOCH ?? '1'}:${prefix}`;
  return { prefix, meter: env.RESUME_METER.get(env.RESUME_METER.idFromName(name)) };
}

// One SQLite database per organization and UTC month. The total and the unique
// marker are committed together without yielding to another request.
export class ResumeMeter extends DurableObject<Env> {
  private readonly sql = this.ctx.storage.sql;
  private importing?: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql.exec('CREATE TABLE IF NOT EXISTS markers (key TEXT PRIMARY KEY, pending INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS pending_mirror ON markers(key) WHERE pending = 1');
    this.sql.exec('CREATE TABLE IF NOT EXISTS meter (id INTEGER PRIMARY KEY, total INTEGER NOT NULL, cursor TEXT, expires INTEGER NOT NULL)');
  }

  private state(): State | undefined {
    return this.sql.exec<{ total: number; cursor: string | null }>('SELECT total, cursor FROM meter WHERE id = 1').toArray()[0];
  }

  private async importLegacy(prefix: string): Promise<void> {
    if (!this.state()) {
      const expires = Date.now() + RESUME_MARKER_TTL_SECONDS * 1000;
      await this.ctx.storage.setAlarm(expires);
      this.sql.exec("INSERT OR IGNORE INTO meter VALUES (1, 0, '', ?)", expires);
    }
    let cursor = this.state()!.cursor;
    while (cursor !== null) {
      const page = await this.env.KV.list({ prefix, limit: 1000, cursor: cursor || undefined });
      cursor = page.list_complete ? null : page.cursor;
      this.ctx.storage.transactionSync(() => {
        const keys = JSON.stringify(page.keys.map(k => k.name));
        this.sql.exec('INSERT OR IGNORE INTO markers SELECT value, 0 FROM json_each(?)', keys);
        this.sql.exec('UPDATE meter SET total = total + changes(), cursor = ? WHERE id = 1', cursor);
      });
    }
  }

  private async ready(prefix: string) {
    const state = this.state();
    if (state?.cursor === null) return state.total;
    this.importing ??= this.importLegacy(prefix).finally(() => { this.importing = undefined; });
    await this.importing;
    return this.state()!.total;
  }

  async count(prefix: string): Promise<number> {
    return this.ready(prefix);
  }

  async record(prefix: string, key: string, limit: number | null): Promise<{ count: number; outcome: Outcome }> {
    await this.ready(prefix);
    // Schedule recovery before committing a reservation. This also covers an
    // isolate restart between that commit and its KV mirror.
    const retryAt = Date.now() + 60_000;
    const wakeAt = await this.ctx.storage.getAlarm();
    if (wakeAt === null || wakeAt > retryAt) await this.ctx.storage.setAlarm(retryAt);
    const result = this.ctx.storage.transactionSync(() => {
      const count = this.state()!.total;
      if (this.sql.exec('SELECT 1 FROM markers WHERE key = ?', key).toArray().length) {
        return { count, outcome: 'repeat' as const };
      }
      if (limit !== null && count >= limit) return { count, outcome: 'refused' as const };
      this.sql.exec('INSERT INTO markers VALUES (?, 1)', key);
      this.sql.exec('UPDATE meter SET total = total + 1 WHERE id = 1');
      return { count: count + 1, outcome: 'counted' as const };
    });
    // Old Workers and existing backup tooling must still see accepted resumes.
    if (result.outcome === 'counted') {
      try {
        await this.mirror(key);
      } catch {
        console.error(JSON.stringify({ event: 'resume_meter_mirror_retry' }));
      }
    }
    return result;
  }

  private async mirror(key: string) {
    await this.env.KV.put(key, '', { expirationTtl: RESUME_MARKER_TTL_SECONDS });
    this.sql.exec('UPDATE markers SET pending = 0 WHERE key = ?', key);
  }

  async alarm() {
    const row = this.sql.exec<{ expires: number }>('SELECT expires FROM meter WHERE id = 1').toArray()[0];
    if (!row || Date.now() >= row.expires) {
      await this.ctx.storage.deleteAll();
      return;
    }
    // Set the next wake-up before network I/O so a provider outage survives
    // the platform's finite automatic alarm retries.
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
    const pending = this.sql.exec<{ key: string }>('SELECT key FROM markers WHERE pending = 1 LIMIT 50').toArray();
    for (const item of pending) await this.mirror(item.key);
    if (!this.sql.exec('SELECT 1 FROM markers WHERE pending = 1 LIMIT 1').toArray().length) {
      await this.ctx.storage.setAlarm(row.expires);
    }
  }
}
