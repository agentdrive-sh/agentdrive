import type { Env } from '../env.js';

export type StorageChecks = Record<'kv' | 'r2', 'ok' | 'unavailable'>;

async function checkRead(read: () => Promise<unknown>): Promise<'ok' | 'unavailable'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Health check timed out')), 1500);
      }),
    ]);
    return 'ok';
  } catch {
    // A public status response must not disclose provider details, credentials or keys.
    return 'unavailable';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function storageReadiness(env: Env): Promise<StorageChecks> {
  // Missing records are successful reads. No health object is created or modified.
  const [kv, r2] = await Promise.all([
    checkRead(() => env.KV.get('__agentdrive_health__')),
    checkRead(() => env.R2.head('__agentdrive_health__')),
  ]);
  return { kv, r2 };
}
