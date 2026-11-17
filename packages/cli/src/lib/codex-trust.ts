import { spawn as nodeSpawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { hookCommand } from './harness-wiring.js';

export interface CodexHook {
  key: string;
  command: string;
  sourcePath: string;
  currentHash: string;
  trustStatus: string;
}

export type CodexTrustResult = { status: 'trusted'; count: number } | { status: 'unavailable'; detail: string };

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

// Only hooks whose command is exactly what init wrote, in the user-level hooks.json:
// anything else (a project's hooks, an edited command) stays behind Codex's own review.
export function adriveHooksToTrust(hooks: CodexHook[], hooksPath: string): CodexHook[] {
  const expected = hookCommand('codex');
  const path = real(hooksPath);
  return hooks.filter(
    (h) => h.command === expected && real(h.sourcePath) === path && (h.trustStatus === 'untrusted' || h.trustStatus === 'modified'),
  );
}

export function trustEdit(hooks: CodexHook[]) {
  return {
    edits: [
      {
        keyPath: 'hooks.state',
        value: Object.fromEntries(hooks.map((h) => [h.key, { trusted_hash: h.currentHash }])),
        mergeStrategy: 'upsert',
      },
    ],
    reloadUserConfig: true,
  };
}

interface RpcMessage {
  id?: number;
  result?: unknown;
  error?: { message?: string };
}

// Codex computes the trust hash itself (hooks/list → currentHash) and writes it the way its
// /hooks screen does (config/batchWrite), so this keeps working if the hash format changes.
export async function trustCodexHooks(
  codexHome: string,
  opts: { spawn?: typeof nodeSpawn; timeoutMs?: number; cwd?: string } = {},
): Promise<CodexTrustResult> {
  const child = (opts.spawn ?? nodeSpawn)('codex', ['app-server'], {
    stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...process.env, CODEX_HOME: codexHome },
  });
  const pending = new Map<number, (m: RpcMessage) => void>();
  let nextId = 0;
  let buf = '';
  let failure: ((err: Error) => void) | undefined;
  const failed = new Promise<never>((_, reject) => {
    failure = reject;
  });
  failed.catch(() => {});
  child.on('error', (err) => failure?.(err));
  child.on('exit', () => failure?.(new Error('codex app-server exited')));
  // Writing to a codex that already exited raises EPIPE here; unhandled, it would kill the whole process.
  child.stdin?.on('error', (err) => failure?.(err));
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    buf += chunk;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let msg: RpcMessage;
      try {
        msg = JSON.parse(line) as RpcMessage;
      } catch {
        continue;
      }
      if (msg.id !== undefined) pending.get(msg.id)?.(msg);
    }
  });
  const send = (body: Record<string, unknown>) => child.stdin?.write(`${JSON.stringify(body)}\n`);
  const call = async (method: string, params: unknown): Promise<unknown> => {
    const id = ++nextId;
    const reply = new Promise<RpcMessage>((resolve) => pending.set(id, resolve));
    send({ id, method, params });
    const msg = await Promise.race([reply, failed]);
    if (msg.error) throw new Error(`${method}: ${msg.error.message ?? 'error'}`);
    return msg.result;
  };

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('codex app-server did not answer in time')), opts.timeoutMs ?? 20_000);
  });
  try {
    return await Promise.race([
      (async (): Promise<CodexTrustResult> => {
        await call('initialize', { clientInfo: { name: 'adrive', version: '1' } });
        send({ method: 'initialized' });
        const listed = (await call('hooks/list', { cwds: [opts.cwd ?? homedir()] })) as { data?: Array<{ hooks?: CodexHook[] }> };
        const hooks = (listed.data ?? []).flatMap((entry) => entry.hooks ?? []);
        const todo = adriveHooksToTrust(hooks, join(codexHome, 'hooks.json'));
        if (todo.length) await call('config/batchWrite', trustEdit(todo));
        return { status: 'trusted', count: todo.length };
      })(),
      timeout,
    ]);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return { status: 'unavailable', detail: e.code === 'ENOENT' ? 'codex is not on PATH' : e.message };
  } finally {
    clearTimeout(timer);
    failure = undefined;
    // SIGKILL: a codex that ignores SIGTERM would otherwise keep init or the sync alive.
    child.kill('SIGKILL');
  }
}
