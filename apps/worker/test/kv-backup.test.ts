import { describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { backupRestClient, exportSnapshot, openBackup, restoreSnapshot, sealBackup, verifySnapshot,
  type BackupClient, type BackupEntry, type KvSnapshot } from '../scripts/kv-backup';

const ACCOUNT = 'a'.repeat(32);
const SOURCE = 'b'.repeat(32);
const TARGET = 'c'.repeat(32);
const NOW = 1_800_000_000_000;
const KEY = Buffer.alloc(32, 9).toString('base64');
const entries: BackupEntry[] = [
  { name: 'session:private/%', value_base64: Buffer.from('synthetic private value').toString('base64'), metadata: { owner: 'synthetic', nested: { z: 1, a: true } }, expiration: NOW / 1000 + 3600 },
  { name: 'binary', value_base64: Buffer.from([0, 255, 128, 1]).toString('base64'), metadata: null },
  { name: 'empty', value_base64: '' },
];
const snapshot = (): KvSnapshot => ({ version: 1, account_id: ACCOUNT, source_namespace: SOURCE, created_at: new Date(NOW).toISOString(), entries: structuredClone(entries) });

function memory(initial: BackupEntry[] = []) {
  const records = new Map(initial.map((entry) => [entry.name, structuredClone(entry)]));
  const client: BackupClient = {
    list: vi.fn(async () => ({ keys: [...records.values()].map(({ value_base64: _value, ...descriptor }) => descriptor) })),
    get: vi.fn(async (name) => {
      const entry = records.get(name);
      return entry ? { value: Buffer.from(entry.value_base64, 'base64'), expiration: entry.expiration } : null;
    }),
    put: vi.fn(async (entry) => { records.set(entry.name, structuredClone(entry)); }),
  };
  return { client, records };
}

describe('encrypted KV backup', async () => {
  it('authenticates binary, empty values, metadata and absolute expiration without plaintext identifiers', async () => {
    const sealed = await sealBackup(snapshot(), KEY);
    expect(sealed).not.toContain('session:private');
    expect(sealed).not.toContain('synthetic private value');
    expect(await openBackup(sealed, KEY)).toEqual(snapshot());
    expect(await sealBackup(snapshot(), KEY)).not.toBe(sealed);
  });

  it.each(['wrong-key', 'ciphertext', 'tag'] as const)('rejects %s before any restore', async (kind) => {
    const envelope = JSON.parse(await sealBackup(snapshot(), KEY));
    if (kind !== 'wrong-key') {
      const value = Buffer.from(envelope[kind], 'base64'); value[0] ^= 1; envelope[kind] = value.toString('base64');
    }
    await expect(openBackup(JSON.stringify(envelope), kind === 'wrong-key' ? Buffer.alloc(32, 10).toString('base64') : KEY)).rejects.toThrow(/authentication failed/);
  });

  it('follows opaque cursors and preserves list metadata plus GET expiration and binary bytes', async () => {
    const urls: string[] = [];
    const values = [entries[0]!, entries[1]!];
    const fetchImpl: typeof fetch = vi.fn(async (input) => {
      const url = String(input); urls.push(url);
      if (url.includes('/keys?')) {
        const second = new URL(url).searchParams.get('cursor') === 'opaque+/=';
        const { value_base64: _value, ...descriptor } = values[second ? 1 : 0]!;
        return Response.json({ success: true, result: [descriptor], result_info: { cursor: second ? '' : 'opaque+/=' } });
      }
      const name = decodeURIComponent(url.split('/values/')[1]!);
      const value = values.find((entry) => entry.name === name)!;
      return new Response(Buffer.from(value.value_base64, 'base64'), { headers: value.expiration ? { expiration: String(value.expiration) } : {} });
    });
    const result = await exportSnapshot(backupRestClient(ACCOUNT, 'synthetic-token', SOURCE, fetchImpl), ACCOUNT, SOURCE, NOW);
    expect(result.entries).toEqual([...values].sort((a, b) => a.name.localeCompare(b.name)));
    expect(urls.some((url) => url.includes('cursor=opaque%2B%2F%3D'))).toBe(true);
    expect(urls.some((url) => url.endsWith('/values/session%3Aprivate%2F%25'))).toBe(true);
  });

  it('refuses an incomplete export when the source changes or pagination loops', async () => {
    const changed = memory(entries);
    vi.mocked(changed.client.get).mockResolvedValueOnce(null);
    await expect(exportSnapshot(changed.client, ACCOUNT, SOURCE, NOW)).rejects.toThrow(/source changed/);
    const looping = memory();
    vi.mocked(looping.client.list).mockResolvedValue({ keys: [], cursor: 'same-cursor' });
    await expect(exportSnapshot(looping.client, ACCOUNT, SOURCE, NOW)).rejects.toThrow(/cursor repeated/);
  });

  it('rejects malformed, duplicate-key or unsupported payloads instead of restoring a partial backup', async () => {
    const duplicate = snapshot(); duplicate.entries.push(duplicate.entries[0]!);
    await expect(sealBackup(duplicate, KEY)).rejects.toThrow(/duplicate/);
    const badExpiry = snapshot(); badExpiry.entries[0]!.expiration = 1.5;
    await expect(sealBackup(badExpiry, KEY)).rejects.toThrow(/expiration/);
    await expect(sealBackup(snapshot(), 'not a 32 byte key')).rejects.toThrow(/encoding|key length/);
  });
});

describe('empty-target KV restore and verification', () => {
  it('is dry-run by default and requires explicit apply plus isolated-target precondition', async () => {
    const { client, records } = memory();
    expect(await restoreSnapshot(client, snapshot(), TARGET, { now: () => NOW })).toEqual({ restored: 3, expired: 0, dry_run: true });
    expect(client.put).not.toHaveBeenCalled();
    await expect(restoreSnapshot(client, snapshot(), TARGET, { apply: true, now: () => NOW })).rejects.toThrow(/isolated-target/);
    expect(records.size).toBe(0);
  });

  it('rejects same namespace, nonempty namespace and hidden existing-key races without writes', async () => {
    const same = memory();
    await expect(restoreSnapshot(same.client, snapshot(), SOURCE)).rejects.toThrow(/different target/);
    expect(same.client.list).not.toHaveBeenCalled();
    const nonempty = memory([entries[0]!]);
    await expect(restoreSnapshot(nonempty.client, snapshot(), TARGET)).rejects.toThrow(/EMPTY/);
    expect(nonempty.client.put).not.toHaveBeenCalled();
    const hidden = memory([entries[0]!]);
    vi.mocked(hidden.client.list).mockResolvedValue({ keys: [] });
    await expect(restoreSnapshot(hidden.client, snapshot(), TARGET, { apply: true, isolatedTarget: true, now: () => NOW })).rejects.toThrow(/existing key/);
    expect(hidden.client.put).not.toHaveBeenCalled();
  });

  it('applies binary values, metadata and original absolute TTL then verifies read-back', async () => {
    const { client, records } = memory();
    expect(await restoreSnapshot(client, snapshot(), TARGET, { apply: true, isolatedTarget: true, now: () => NOW })).toEqual({ restored: 3, expired: 0, dry_run: false });
    expect([...records.values()]).toEqual(entries);
    expect(await verifySnapshot(client, snapshot(), NOW)).toEqual({ verified: 3, expired: 0 });
    expect(records.get(entries[0]!.name)?.expiration).toBe(NOW / 1000 + 3600);
  });

  it('never revives expired records or extends an imminent expiration to satisfy API limits', async () => {
    const expired = snapshot(); expired.entries[0]!.expiration = NOW / 1000 - 1;
    const { client, records } = memory();
    expect(await restoreSnapshot(client, expired, TARGET, { apply: true, isolatedTarget: true, now: () => NOW })).toEqual({ restored: 2, expired: 1, dry_run: false });
    expect(records.has(entries[0]!.name)).toBe(false);
    const imminent = snapshot(); imminent.entries[0]!.expiration = NOW / 1000 + 59;
    const empty = memory();
    await expect(restoreSnapshot(empty.client, imminent, TARGET, { apply: true, isolatedTarget: true, now: () => NOW })).rejects.toThrow(/within 60 seconds/);
    expect(empty.client.put).not.toHaveBeenCalled();
  });

  it.each(['value', 'metadata', 'expiration'] as const)('detects changed %s during verification', async (field) => {
    const altered = structuredClone(entries);
    if (field === 'value') altered[0]!.value_base64 = Buffer.from('wrong content').toString('base64');
    if (field === 'metadata') altered[0]!.metadata = { owner: 'someone else' };
    if (field === 'expiration') altered[0]!.expiration!++;
    await expect(verifySnapshot(memory(altered).client, snapshot(), NOW)).rejects.toThrow(/verification/);
  });

  it('sends binary multipart values, JSON metadata and exact expiration without TTL reset', async () => {
    let request: Request | undefined;
    const fetchImpl: typeof fetch = vi.fn(async (input, init) => { request = new Request(String(input), init); return Response.json({ success: true, result: {} }); });
    await backupRestClient(ACCOUNT, 'synthetic-token', TARGET, fetchImpl).put(entries[0]!);
    expect(new URL(request!.url).searchParams.get('expiration')).toBe(String(entries[0]!.expiration));
    expect(new URL(request!.url).searchParams.has('expiration_ttl')).toBe(false);
    const form = await request!.formData();
    expect(JSON.parse(form.get('metadata') as string)).toEqual(entries[0]!.metadata);
    expect(await (form.get('value') as Blob).text()).toBe('synthetic private value');
    expect(request!.headers.get('Authorization')).toBe('Bearer synthetic-token');
  });
});
