import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env.js';
import { generateMagicCode } from '../services/email.js';

// One instance per lowercased email (idFromName), holding that address's sign-in code.
// Each method reads and writes storage with no other I/O in between, so the input gate
// runs concurrent calls one after another: a burst of guesses is counted guess by guess.

const CODE_TTL_MS = 10 * 60_000;
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60_000;
const LOCK_MS = 15 * 60_000;
// A resend repeats the live code, so one sign-in rarely needs more than two sends; five
// leaves room for an invite and a few retries while holding one address to five emails an
// hour, and each lockout cycle needs one of them.
export const MAX_SENDS_PER_HOUR = 5;
const HOUR_MS = 60 * 60_000;

export type MagicPurpose = 'verify' | 'login';
export interface MagicContext { workspace_id?: string; token_id?: string }

interface CodeState {
  code?: string;
  // Only a code whose email went out can sign in, so a failed send never displaces one that arrived.
  delivered?: boolean;
  purpose?: MagicPurpose;
  context?: MagicContext;
  expires_at?: number;
  failures: number;
  window_end?: number;
  locked_until?: number;
  sends: number[];
}

export type IssueResult =
  | { status: 'issued'; code: string }
  | { status: 'locked' | 'capped'; retry_after: number };

export type VerifyResult =
  | { status: 'ok'; purpose: MagicPurpose; context?: MagicContext }
  | { status: 'invalid' }
  | { status: 'locked'; retry_after: number };

const secondsUntil = (at: number, now: number) => Math.max(1, Math.ceil((at - now) / 1000));

function sameCode(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y);
}

export class MagicCodes extends DurableObject<Env> {
  private async load(): Promise<CodeState> {
    return (await this.ctx.storage.get<CodeState>('state')) ?? { failures: 0, sends: [] };
  }

  // The alarm clears the address's state once nothing in it can matter any more, so
  // addresses that were sent a code once do not keep storage forever.
  private async save(state: CodeState): Promise<void> {
    await this.ctx.storage.put('state', state);
    const lastSend = state.sends.at(-1);
    const until = Math.max(state.expires_at ?? 0, state.window_end ?? 0, state.locked_until ?? 0, lastSend ? lastSend + HOUR_MS : 0);
    await this.ctx.storage.setAlarm(Math.max(until, Date.now()) + 1000);
  }

  async alarm(): Promise<void> {
    const state = await this.load();
    const now = Date.now();
    const live = [state.expires_at, state.window_end, state.locked_until, ...state.sends.map((at) => at + HOUR_MS)].some((t) => t !== undefined && t > now);
    if (live) await this.ctx.storage.setAlarm(now + 60_000);
    else await this.ctx.storage.deleteAll();
  }

  // The code to email: the live one if there is one, so a resend never invalidates it. Each
  // send restarts the expiry the email states and carries the latest request's flow.
  async issue(purpose: MagicPurpose, context?: MagicContext): Promise<IssueResult> {
    const now = Date.now();
    const state = await this.load();
    if (state.locked_until && state.locked_until > now) return { status: 'locked', retry_after: secondsUntil(state.locked_until, now) };
    state.sends = state.sends.filter((at) => at > now - HOUR_MS);
    if (state.sends.length >= MAX_SENDS_PER_HOUR) return { status: 'capped', retry_after: secondsUntil(state.sends[0]! + HOUR_MS, now) };
    state.sends.push(now);
    if (!state.code || !state.expires_at || state.expires_at <= now) {
      Object.assign(state, { code: generateMagicCode(), delivered: false });
    }
    Object.assign(state, { purpose, context, expires_at: now + CODE_TTL_MS });
    await this.save(state);
    return { status: 'issued', code: state.code! };
  }

  async delivered(code: string): Promise<void> {
    const state = await this.load();
    if (state.code !== code || state.delivered) return;
    state.delivered = true;
    await this.save(state);
  }

  async verify(code: string): Promise<VerifyResult> {
    const now = Date.now();
    const state = await this.load();
    if (state.locked_until && state.locked_until > now) return { status: 'locked', retry_after: secondsUntil(state.locked_until, now) };
    if (!state.code || !state.delivered || !state.expires_at || state.expires_at <= now) return { status: 'invalid' };
    if (sameCode(state.code, code)) {
      await this.save({ failures: 0, sends: state.sends });
      return { status: 'ok', purpose: state.purpose!, context: state.context };
    }
    if (!state.window_end || state.window_end <= now) {
      state.failures = 0;
      state.window_end = now + FAILURE_WINDOW_MS;
    }
    state.failures += 1;
    if (state.failures >= MAX_FAILURES) {
      await this.save({ failures: 0, sends: state.sends, locked_until: now + LOCK_MS });
      return { status: 'locked', retry_after: LOCK_MS / 1000 };
    }
    await this.save(state);
    return { status: 'invalid' };
  }
}
