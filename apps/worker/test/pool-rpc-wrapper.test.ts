import { env, runInDurableObject } from 'cloudflare:test';
import { createDurableObjectWrapper, internalEnv } from 'cloudflare:test-internal';
import { expect, it } from 'vitest';

// SELF and Durable Object RPC use the same proxy factory in the pinned pool.
// Two constructions reveal a growing prototype chain without a load test.
it('keeps one RPC prototype while resolving methods against each object instance', async () => {
  const Wrapper = createDurableObjectWrapper('MagicCodes');
  const prototype = Wrapper.prototype;
  for (const purpose of ['login', 'verify'] as const) {
    const stub = env.MAGIC_CODES.get(env.MAGIC_CODES.idFromName(purpose));
    await runInDurableObject(stub, async (_instance, state) => {
      const wrapper = new Wrapper(state, internalEnv);
      expect(Object.getPrototypeOf(wrapper) === prototype).toBe(true);
      const result = await wrapper.issue(purpose);
      expect(result.status).toBe('issued');
      expect(await state.storage.get('state')).toMatchObject({ code: result.code, purpose });
    });
  }
});
