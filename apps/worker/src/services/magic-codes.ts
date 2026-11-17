import type { Env } from '../env.js';
import type { MagicContext, MagicPurpose, VerifyResult } from '../durable-objects/magic-codes.js';
import { EmailService } from './email.js';

function gate(env: Env, email: string) {
  return env.MAGIC_CODES.get(env.MAGIC_CODES.idFromName(email.toLowerCase()));
}

export type SendResult = { status: 'sent' | 'failed' } | { status: 'locked' | 'capped'; retry_after: number };

export async function sendMagicCode(env: Env, email: string, purpose: MagicPurpose, context?: MagicContext): Promise<SendResult> {
  const codes = gate(env, email);
  const issued = await codes.issue(purpose, context);
  if (issued.status !== 'issued') return issued;
  if (!(await new EmailService(env).sendMagicCode(email, issued.code, purpose))) return { status: 'failed' };
  await codes.delivered(issued.code);
  return { status: 'sent' };
}

export function verifyMagicCode(env: Env, email: string, code: string): Promise<VerifyResult> {
  return gate(env, email).verify(code);
}
