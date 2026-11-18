import { describe, it, expect, vi } from 'vitest';
import prod from '../wrangler.toml?raw';
import embeddings from '../src/services/embeddings.ts?raw';
import {
  BOOTSTRAP_SECRET, SECRETS, VECTORIZE, blocks, ownWorker, provision, registerWithToken, selfhostConfig, setMissingSecrets, value, workersDevUrl,
  type ProvisionOptions,
} from '../scripts/selfhost';

const URL = 'https://agentdrive.synthetic.workers.dev';
const kvIds = { KV: 'a'.repeat(32), OAUTH_KV: 'b'.repeat(32) };
const generate = (selfBinding = true) => selfhostConfig(prod, { name: 'agentdrive', url: URL, kvIds, selfBinding });

describe('production wrangler.toml', () => {
  it('never sets SELF_HOSTED', () => {
    expect(prod).not.toMatch(/SELF_HOSTED/);
  });
});

describe('selfhostConfig', () => {
  it('carries no production resource ID, bucket, index, service or route', () => {
    const out = generate();
    const prodIds = blocks(prod).filter((b) => b.header === '[[kv_namespaces]]').map((b) => value(b, 'id')!);
    expect(prodIds).toHaveLength(2);
    for (const id of prodIds) expect(out).not.toContain(id);
    expect(out).not.toMatch(/agentdrive-worker|agentdrive-content|agentdrive\.sh|routes?\s*=|\[assets\]/);
  });

  it('points every binding at the self-hosted resources', () => {
    const out = blocks(generate());
    const kv = out.filter((b) => b.header === '[[kv_namespaces]]').map((b) => [value(b, 'binding'), value(b, 'id')]);
    expect(Object.fromEntries(kv)).toEqual(kvIds);
    expect(value(out.find((b) => b.header === '[[r2_buckets]]')!, 'bucket_name')).toBe('agentdrive-r2');
    expect(value(out.find((b) => b.header === '[[vectorize]]')!, 'index_name')).toBe('agentdrive-vectorize');
    expect(value(out[0]!, 'name')).toBe('agentdrive');
    expect(out.filter((b) => b.header === '[[ratelimits]]')).toHaveLength(4);
    expect(out.some((b) => b.header === '[durable_objects]')).toBe(true);
  });

  it('carries the production Durable Object bindings and every migration', () => {
    const out = generate();
    expect(out).toContain('{ name = "FILE_COLLAB", class_name = "FileCollab" },');
    expect(out).toContain('{ name = "MAGIC_CODES", class_name = "MagicCodes" }');
    const migrations = blocks(out).filter((b) => b.header === '[[migrations]]').map((b) => b.lines.join('\n'));
    expect(out).toContain('{ name = "RESUME_METER", class_name = "ResumeMeter" }');
    expect(migrations).toEqual(blocks(prod).filter(b => b.header === '[[migrations]]').map(b => b.lines.join('\n')));
    expect(migrations).toContain('tag = "v4-resume"\nnew_sqlite_classes = ["ResumeMeter"]');
    expect(out).toContain('{ name = "IDEMPOTENCY", class_name = "IdempotencyRecord" }');
    expect(migrations).toContain('tag = "v5-idempotency"\nnew_sqlite_classes = ["IdempotencyRecord"]');
  });

  it('sets SELF_HOSTED and the deployed URL', () => {
    const vars = blocks(generate()).find((b) => b.header === '[vars]')!;
    expect(value(vars, 'SELF_HOSTED')).toBe('true');
    expect(value(vars, 'APP_URL')).toBe(URL);
    expect(value(vars, 'SITE_URL')).toBe(URL);
    expect(value(vars, 'MCP_URL')).toBe(`${URL}/mcp`);
  });

  it("drops WORKERS_DEV_SUBDOMAIN, so CORS on the instance never trusts our account's web app", () => {
    expect(value(blocks(prod).find((b) => b.header === '[vars]')!, 'WORKERS_DEV_SUBDOMAIN')).toBe('comfyfw');
    expect(generate()).not.toContain('WORKERS_DEV_SUBDOMAIN');
  });

  it('never keeps send_email: a self-hosted instance sends no mail', () => {
    expect(prod).toContain('[[send_email]]');
    expect(generate()).not.toMatch(/send_email|SEND_EMAIL/);
  });

  it('refuses a production section or top-level key it does not know', () => {
    expect(() => selfhostConfig(`${prod}\n[[d1_databases]]\nbinding = "DB"\n`, { name: 'x-y', url: URL, kvIds, selfBinding: true })).toThrow(/d1_databases/);
    expect(() => selfhostConfig(`tail_consumers = []\n${prod}`, { name: 'x-y', url: URL, kvIds, selfBinding: true })).toThrow(/tail_consumers/);
  });

  it('binds SELF to the self-hosted worker, and leaves it out until that worker exists', () => {
    const self = blocks(generate()).filter((b) => b.header === '[[services]]');
    expect(self.map((b) => [value(b, 'binding'), value(b, 'service')])).toEqual([['SELF', 'agentdrive']]);
    expect(generate(false)).not.toContain('[[services]]');
    const other = selfhostConfig(`${prod}\n[[services]]\nbinding = "BILLING"\nservice = "agentdrive-billing"\n`, { name: 'x-y', url: URL, kvIds, selfBinding: true });
    expect(other).not.toContain('agentdrive-billing');
  });

  it('drops routes and an account id from the top level', () => {
    const out = selfhostConfig(`routes = [{ pattern = "app.example.com", custom_domain = true }]\naccount_id = "abc"\n${prod}`, { name: 'x-y', url: URL, kvIds, selfBinding: true });
    expect(out).not.toMatch(/routes|account_id|app\.example\.com/);
  });
});

describe('selfhost helpers', () => {
  it('matches the embedding model dimensions', () => {
    expect(embeddings).toContain(`EMBEDDING_DIMS = ${VECTORIZE.dimensions};`);
  });

  it('finds the workers.dev URL in deploy output', () => {
    expect(workersDevUrl(`Uploaded agentdrive (3.1 sec)\nDeployed agentdrive triggers\n  ${URL}\nCurrent Version ID: 1`)).toBe(URL);
    expect(workersDevUrl('no url here')).toBeUndefined();
  });
});

describe('ownWorker', () => {
  const version = (bindings: Array<{ type: string; name: string; text?: string }>) => JSON.stringify({ resources: { bindings } });
  const fake = (status: string | Error, views: Record<string, string>) => (argv: string[]) => {
    if (argv[0] === 'deployments') {
      if (status instanceof Error) throw status;
      return status;
    }
    return views[argv[2]!]!;
  };
  const deployed = JSON.stringify({ versions: [{ version_id: 'v1', percentage: 100 }] });

  it('reports a missing worker as new', () => {
    expect(ownWorker('agentdrive', fake(new Error('This Worker does not exist on your account. [code: 10007]'), {}))).toBe(false);
  });

  it('accepts a worker whose live version came from the self-host template', () => {
    expect(ownWorker('agentdrive', fake(deployed, { v1: version([{ type: 'plain_text', name: 'SELF_HOSTED', text: 'true' }]) }))).toBe(true);
  });

  it('refuses a worker this script did not deploy', () => {
    const prodLike = version([{ type: 'plain_text', name: 'APP_URL', text: 'https://app.agentdrive.sh' }]);
    expect(() => ownWorker('agentdrive', fake(deployed, { v1: prodLike }))).toThrow(/not deployed by pnpm selfhost/);
    const split = JSON.stringify({ versions: [{ version_id: 'v1' }, { version_id: 'v2' }] });
    expect(() => ownWorker('agentdrive', fake(split, { v1: version([{ type: 'plain_text', name: 'SELF_HOSTED', text: 'true' }]), v2: prodLike })))
      .toThrow(/not deployed by pnpm selfhost/);
  });

  it('fails closed on any other error', () => {
    expect(() => ownWorker('agentdrive', fake(new Error('Authentication error [code: 10000]'), {}))).toThrow(/Authentication/);
  });
});

describe('setMissingSecrets', () => {
  it('generates only the missing secrets', async () => {
    const put = vi.fn();
    const generated = await setMissingSecrets(['TOKEN_SIGNING_SECRET'], put);
    expect(Object.keys(generated)).toEqual(['BUCKET_KEK_ROOT', 'BUCKET_KEK_VERSION']);
    expect(generated.BUCKET_KEK_ROOT).toMatch(/^[0-9a-f]{64}$/);
    expect(generated.BUCKET_KEK_VERSION).toBe('1');
    expect(put.mock.calls).toEqual(Object.entries(generated));
  });

  it('sets nothing when the backup file cannot be written', async () => {
    const put = vi.fn();
    const backup = vi.fn().mockRejectedValue(Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' }));
    await expect(setMissingSecrets([], put, backup)).rejects.toThrow(/EEXIST/);
    expect(put).not.toHaveBeenCalled();
  });

  it('has every value on disk before the first put, so a failing second put loses nothing', async () => {
    const order: string[] = [];
    let saved: Record<string, string> = {};
    const backup = vi.fn(async (values: Record<string, string>) => { order.push('backup'); saved = values; });
    const put = vi.fn((name: string) => {
      order.push(name);
      if (order.length === 3) throw new Error('secret put failed');
    });
    await expect(setMissingSecrets([], put, backup)).rejects.toThrow(/secret put failed/);
    expect(order).toEqual(['backup', SECRETS[0], SECRETS[1]]);
    expect(Object.keys(saved)).toEqual([...SECRETS]);
    expect(put.mock.calls[0]).toEqual([SECRETS[0], saved[SECRETS[0]]]);
  });
});

describe('provision', () => {
  const CONFIG = 'wrangler.selfhost.toml';
  const KEY = { api_key: 'agentdrive_live_synthetic', org_id: 'org_synthetic' };

  // Records every step in order; secret values show up only as stdin, never in argv.
  function fake(state: { secrets?: string[]; orgs?: number; failDelete?: boolean } = {}) {
    const log: string[] = [];
    const inputs: Record<string, string> = {};
    const argvs: string[][] = [];
    const wrangler = (argv: string[], input?: string) => {
      argvs.push(argv);
      const [cmd, verb, name] = argv;
      if (cmd === 'secret' && verb === 'list') { log.push('secret list'); return JSON.stringify((state.secrets ?? []).map((n) => ({ name: n }))); }
      if (cmd === 'secret' && verb === 'put') { log.push(`put ${name}`); inputs[name!] = input!; return ''; }
      if (cmd === 'secret' && verb === 'delete') {
        log.push(`delete ${name}`);
        if (state.failDelete) throw new Error('delete failed');
        return '';
      }
      if (cmd === 'kv') { log.push('kv list'); return JSON.stringify(Array.from({ length: state.orgs ?? 0 }, (_, i) => ({ name: `org:${i}` }))); }
      throw new Error(`unexpected wrangler ${argv.join(' ')}`);
    };
    const register = vi.fn(async (token: string) => { log.push('register'); expect(token).toBe(inputs[BOOTSTRAP_SECRET]); return KEY; });
    const options = (extra: Partial<ProvisionOptions> = {}): ProvisionOptions => ({
      onInterrupt: (cleanup) => { interrupt = cleanup; log.push('hook'); return () => { log.push('unhook'); }; },
      deploy: () => { log.push('deploy'); }, wrangler, configPath: CONFIG, kvId: 'k', forceRegister: false, register, ...extra,
    });
    let interrupt: (() => void) | undefined;
    return { log, inputs, argvs, options, interrupt: () => interrupt!() };
  }

  it('deploys closed, sets the secrets, then registers with a one-time token and deletes it', async () => {
    const f = fake();
    const result = await provision(f.options());
    expect(f.log).toEqual([
      'deploy', 'secret list', ...SECRETS.map((s) => `put ${s}`), 'kv list', 'hook', `put ${BOOTSTRAP_SECRET}`, 'register', `delete ${BOOTSTRAP_SECRET}`, 'unhook',
    ]);
    expect(result.registered).toEqual(KEY);
    expect(f.inputs[BOOTSTRAP_SECRET]).toMatch(/^[0-9a-f]{64}$/);
    for (const secretValue of Object.values(f.inputs)) expect(f.argvs.flat()).not.toContain(secretValue);
  });

  it('registers nothing when an org exists, unless --register asks for recovery', async () => {
    const existing = fake({ secrets: [...SECRETS], orgs: 1 });
    expect((await provision(existing.options())).registered).toBeNull();
    expect(existing.log).toEqual(['deploy', 'secret list', 'kv list']);

    const recovery = fake({ secrets: [...SECRETS], orgs: 1 });
    expect((await provision(recovery.options({ forceRegister: true }))).registered).toEqual(KEY);
    expect(recovery.log).toEqual(['deploy', 'secret list', 'kv list', 'hook', `put ${BOOTSTRAP_SECRET}`, 'register', `delete ${BOOTSTRAP_SECRET}`, 'unhook']);
  });

  it('deletes the token even when registration fails', async () => {
    const f = fake();
    await expect(provision(f.options({ register: async () => { throw new Error('register failed'); } }))).rejects.toThrow(/register failed/);
    expect(f.log.slice(-2)).toEqual([`delete ${BOOTSTRAP_SECRET}`, 'unhook']);
  });

  it('still hands back the new key when deleting the token fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = fake({ failDelete: true });
    expect((await provision(f.options())).registered).toEqual(KEY);
    expect(String(error.mock.calls[0]![0])).toMatch(/secret delete SELF_HOSTED_BOOTSTRAP_TOKEN/);
    error.mockRestore();
  });

  it('removes a token a dead run left behind, and never treats it as a normal secret', async () => {
    const f = fake({ secrets: [...SECRETS, BOOTSTRAP_SECRET], orgs: 1 });
    await provision(f.options());
    expect(f.log).toEqual(['deploy', 'secret list', 'kv list', `delete ${BOOTSTRAP_SECRET}`]);
  });

  it('deletes the token once when interrupted mid-registration', async () => {
    const f = fake();
    const register = async () => {
      f.interrupt();
      throw new Error('interrupted');
    };
    await expect(provision(f.options({ register }))).rejects.toThrow(/interrupted/);
    expect(f.log.filter((l) => l === `delete ${BOOTSTRAP_SECRET}`)).toHaveLength(1);
    expect(f.log.indexOf(`delete ${BOOTSTRAP_SECRET}`)).toBeGreaterThan(f.log.indexOf(`put ${BOOTSTRAP_SECRET}`));
  });
});

describe('registerWithToken', () => {
  const KEY = { api_key: 'agentdrive_live_synthetic', org_id: 'org_selfhosted' };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const closed = () => json(403, { success: false, code: 'registration_closed', error: 'closed' });
  function run(...responses: Array<Response | Error>) {
    const calls: RequestInit[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls.push(init);
      const next = responses[Math.min(calls.length - 1, responses.length - 1)]!;
      if (next instanceof Error) throw next;
      return next;
    }) as unknown as typeof fetch;
    return { calls, promise: registerWithToken(URL, 'tok', { fetchImpl, sleep: async () => {}, attempts: 4 }) };
  }

  it('sends the token in a header and returns the key', async () => {
    const r = run(json(201, { success: true, data: KEY }));
    expect(await r.promise).toEqual(KEY);
    expect(new Headers(r.calls[0]!.headers).get('X-Bootstrap-Token')).toBe('tok');
    expect(r.calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  it('retries a network error and a not-yet-propagated token', async () => {
    const r = run(new Error('fetch failed'), closed(), json(201, { success: true, data: KEY }));
    expect(await r.promise).toEqual(KEY);
    expect(r.calls).toHaveLength(3);
  });

  it('stops at once on any other failure', async () => {
    for (const res of [json(500, { success: false, error: 'boom' }), json(403, { success: false, code: 'other' }), json(400, { success: false })]) {
      const r = run(res);
      await expect(r.promise).rejects.toThrow(/--register/);
      expect(r.calls).toHaveLength(1);
    }
  });

  it('gives up after the last attempt', async () => {
    const r = run(closed(), closed(), closed(), closed());
    await expect(r.promise).rejects.toThrow(/403/);
    expect(r.calls).toHaveLength(4);
  });
});
