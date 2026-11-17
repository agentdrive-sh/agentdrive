import { describe, it, expect } from 'vitest';
import { EmailService } from '../src/services/email';
import type { Env } from '../src/env';

// Builds a minimal Env stub for EmailService. Only the fields sendMagicCode
// reads matter; the rest are never touched on the no-transport paths.
function envWith(over: Partial<Env>): Env {
  return { ENVIRONMENT: 'test', ...over } as unknown as Env;
}

describe('EmailService.sendMagicCode transport behavior', () => {
  it('logs and succeeds in dev/test when no transport is configured', async () => {
    const svc = new EmailService(envWith({}));
    expect(await svc.sendMagicCode('user@example.com', '123456', 'login')).toBe(true);
  });

  it('does NOT silently succeed in production with no transport', async () => {
    // Regression guard: the old code returned true (claiming "code sent") even
    // when no email could go out. Production must surface the failure.
    const svc = new EmailService(envWith({ ENVIRONMENT: 'production' }));
    expect(await svc.sendMagicCode('user@example.com', '123456', 'login')).toBe(false);
  });
});
