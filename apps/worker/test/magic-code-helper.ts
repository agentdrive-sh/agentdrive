import { env } from 'cloudflare:test';
import type { Env } from '../src/env';

// The email's live sign-in code, as if its email had arrived. Counts against the send cap.
export async function deliveredCode(email: string): Promise<string> {
  const ns = (env as unknown as Env).MAGIC_CODES;
  const codes = ns.get(ns.idFromName(email.toLowerCase()));
  const issued = await codes.issue('login');
  if (issued.status !== 'issued') throw new Error(`no code for ${email}: ${issued.status}`);
  await codes.delivered(issued.code);
  return issued.code;
}
