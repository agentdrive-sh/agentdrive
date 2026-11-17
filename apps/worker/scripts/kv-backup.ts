// Encrypted, binary-safe KV export and restore into a dedicated empty namespace.
// Node >=22.15. Secrets: CLOUDFLARE_API_TOKEN and AGENTDRIVE_BACKUP_KEY (base64
// encoded 32 random bytes). Never pass either secret as a command argument.
//
// node apps/worker/scripts/kv-backup.ts export <source-namespace> <new-file>
// node apps/worker/scripts/kv-backup.ts restore <backup-file> <target-namespace>
// node apps/worker/scripts/kv-backup.ts restore <backup-file> <target-namespace> --apply --isolated-target
// node apps/worker/scripts/kv-backup.ts verify <backup-file> <target-namespace>
//
// Freeze source writes during export. Target must be unbound/no other writers:
// KV has no atomic snapshot or documented create-only PUT. We reject observed
// existing keys and never delete/overwrite them, but cannot prevent a competing
// external writer racing the API's unconditional PUT. No in-place restore.
import { randomBytes, webcrypto } from 'node:crypto';
import { Buffer } from 'node:buffer';

const AAD = Uint8Array.from(Buffer.from('agentdrive-kv-backup:1:AES-256-GCM'));
const MAX_BYTES = 256 * 1024 * 1024;
const ID = /^[a-f0-9]{32}$/;
// Node's native WebCrypto; the Worker test runtime exposes the same API globally.
const subtle = webcrypto?.subtle ?? globalThis.crypto.subtle;

export interface KeyRecord { name: string; expiration?: number; metadata?: unknown }
export interface BackupEntry extends KeyRecord { value_base64: string }
export interface KvSnapshot { version: 1; account_id: string; source_namespace: string; created_at: string; entries: BackupEntry[] }
export interface BackupClient {
  list(cursor?: string): Promise<{ keys: KeyRecord[]; cursor?: string }>;
  get(name: string): Promise<{ value: Uint8Array; expiration?: number } | null>;
  put(entry: BackupEntry): Promise<void>;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}

function bytes(value: unknown, expected?: number): Buffer {
  if (typeof value !== 'string') throw new Error('Invalid backup encoding');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value || (expected !== undefined && decoded.length !== expected)) throw new Error('Invalid backup encoding or key length');
  return decoded;
}

function validate(snapshot: KvSnapshot): void {
  if (!snapshot || snapshot.version !== 1 || !ID.test(snapshot.account_id) || !ID.test(snapshot.source_namespace)
    || !Number.isFinite(Date.parse(snapshot.created_at)) || !Array.isArray(snapshot.entries)) throw new Error('Invalid backup schema');
  const seen = new Set<string>();
  for (const entry of snapshot.entries) {
    if (!entry || typeof entry.name !== 'string' || !entry.name || entry.name === '.' || entry.name === '..'
      || Buffer.byteLength(entry.name) > 512 || seen.has(entry.name)) throw new Error('Invalid or duplicate backup key');
    seen.add(entry.name);
    if (entry.expiration !== undefined && (!Number.isSafeInteger(entry.expiration) || entry.expiration < 0)) throw new Error('Invalid backup expiration');
    if (bytes(entry.value_base64).length > 25 * 1024 * 1024) throw new Error('Backup value exceeds KV limit');
    if (entry.metadata !== undefined && Buffer.byteLength(JSON.stringify(entry.metadata)) > 1024) throw new Error('Backup metadata exceeds KV limit');
  }
}

export async function sealBackup(snapshot: KvSnapshot, key: string): Promise<string> {
  validate(snapshot);
  const plaintext = Buffer.from(JSON.stringify(snapshot));
  if (plaintext.length > MAX_BYTES) throw new Error('Backup exceeds 256 MiB in-memory safety limit');
  const iv = Uint8Array.from(randomBytes(12));
  const aes = await subtle.importKey('raw', Uint8Array.from(bytes(key, 32)), 'AES-GCM', false, ['encrypt']);
  const sealed = Buffer.from(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 }, aes, Uint8Array.from(plaintext)));
  return JSON.stringify({ format: 'agentdrive-kv-backup', version: 1, algorithm: 'AES-256-GCM', iv: Buffer.from(iv).toString('base64'), tag: sealed.subarray(-16).toString('base64'), ciphertext: sealed.subarray(0, -16).toString('base64') });
}

export async function openBackup(encoded: string, key: string): Promise<KvSnapshot> {
  if (Buffer.byteLength(encoded) > MAX_BYTES * 1.4) throw new Error('Backup exceeds safety limit');
  let envelope;
  try { envelope = JSON.parse(encoded); } catch { throw new Error('Invalid encrypted backup JSON'); }
  if (envelope?.format !== 'agentdrive-kv-backup' || envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM') throw new Error('Unsupported backup format');
  let plaintext: Buffer;
  try {
    const aes = await subtle.importKey('raw', Uint8Array.from(bytes(key, 32)), 'AES-GCM', false, ['decrypt']);
    const sealed = Buffer.concat([bytes(envelope.ciphertext), bytes(envelope.tag, 16)]);
    plaintext = Buffer.from(await subtle.decrypt({ name: 'AES-GCM', iv: Uint8Array.from(bytes(envelope.iv, 12)), additionalData: AAD, tagLength: 128 }, aes, Uint8Array.from(sealed)));
  } catch { throw new Error('Backup authentication failed: wrong key or modified file; no restore performed'); }
  try {
    const snapshot = JSON.parse(plaintext.toString('utf8')) as KvSnapshot;
    validate(snapshot);
    return snapshot;
  } catch { throw new Error('Invalid decrypted backup payload; no restore performed'); }
}

async function listAll(client: BackupClient): Promise<KeyRecord[]> {
  const keys: KeyRecord[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await client.list(cursor);
    if ((page.cursor !== undefined && typeof page.cursor !== 'string') || !Array.isArray(page.keys)) throw new Error('Invalid KV key listing');
    keys.push(...page.keys);
    cursor = page.cursor || undefined;
    if (cursor && cursors.has(cursor)) throw new Error('KV pagination cursor repeated; refusing incomplete export');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  if (new Set(keys.map((k) => k.name)).size !== keys.length) throw new Error('Duplicate KV keys during pagination; source may be changing');
  return keys.sort((a, b) => a.name.localeCompare(b.name));
}

export async function exportSnapshot(client: BackupClient, accountId: string, sourceNamespace: string, now = Date.now()): Promise<KvSnapshot> {
  const listed = await listAll(client);
  const entries: BackupEntry[] = [];
  let size = 0;
  for (const key of listed) {
    const value = await client.get(key.name);
    if (!value || value.expiration !== key.expiration) throw new Error('KV source changed while exporting; freeze writes and retry');
    size += value.value.byteLength;
    if (size > MAX_BYTES) throw new Error('Backup exceeds 256 MiB in-memory safety limit');
    entries.push({ ...key, value_base64: Buffer.from(value.value).toString('base64') });
  }
  const snapshot: KvSnapshot = { version: 1, account_id: accountId, source_namespace: sourceNamespace, created_at: new Date(now).toISOString(), entries };
  validate(snapshot);
  // Re-read values and descriptors to detect visible changes. This is still not
  // a transactional snapshot; quiescence remains an operator precondition.
  await verifySnapshot(client, snapshot, now);
  return snapshot;
}

export async function verifySnapshot(client: BackupClient, snapshot: KvSnapshot, now = Date.now()): Promise<{ verified: number; expired: number }> {
  validate(snapshot);
  const seconds = Math.floor(now / 1000);
  const active = snapshot.entries.filter((entry) => entry.expiration === undefined || entry.expiration > seconds);
  const listed = (await listAll(client)).filter((entry) => entry.expiration === undefined || entry.expiration > seconds);
  if (listed.length !== active.length) throw new Error('KV verification key count differs; no data deleted or overwritten');
  const byName = new Map(listed.map((entry) => [entry.name, entry]));
  for (const entry of active) {
    const actual = byName.get(entry.name);
    if (!actual || canonical(actual.metadata) !== canonical(entry.metadata) || actual.expiration !== entry.expiration) throw new Error('KV verification metadata/expiration differs');
    const value = await client.get(entry.name);
    if (!value || value.expiration !== entry.expiration || !Buffer.from(value.value).equals(bytes(entry.value_base64))) throw new Error('KV verification value differs');
  }
  return { verified: active.length, expired: snapshot.entries.length - active.length };
}

export async function restoreSnapshot(client: BackupClient, snapshot: KvSnapshot, targetNamespace: string,
  options: { apply?: boolean; isolatedTarget?: boolean; now?: () => number } = {}): Promise<{ restored: number; expired: number; dry_run: boolean }> {
  validate(snapshot);
  if (!ID.test(targetNamespace) || targetNamespace === snapshot.source_namespace) throw new Error('Restore requires a different target namespace');
  if ((await listAll(client)).length) throw new Error('Restore target must be EMPTY; existing records will not be overwritten');
  const seconds = Math.floor((options.now ?? Date.now)() / 1000);
  const active = snapshot.entries.filter((entry) => entry.expiration === undefined || entry.expiration > seconds);
  if (active.some((entry) => entry.expiration !== undefined && entry.expiration < seconds + 60)) throw new Error('A record expires within 60 seconds; wait for expiry and retry without extending its TTL');
  const result = { restored: active.length, expired: snapshot.entries.length - active.length, dry_run: !options.apply };
  if (!options.apply) return result;
  if (!options.isolatedTarget) throw new Error('--apply also requires --isolated-target: unbound namespace, no other writers; KV has no create-only PUT');
  // Check every destination before starting, then again immediately before each
  // write. There is no create-only API: isolation is required, not assumed.
  for (const entry of active) if (await client.get(entry.name)) throw new Error('Restore target contains an existing key; no overwrite performed');
  let written = 0;
  for (const entry of active) {
    if (await client.get(entry.name)) throw new Error(`Restore stopped after ${written} writes: a target key appeared; nothing overwritten or deleted`);
    if (entry.expiration !== undefined && entry.expiration < Math.floor((options.now ?? Date.now)() / 1000) + 60) throw new Error(`Restore stopped after ${written} writes: TTL too short; no TTL extended`);
    await client.put(entry);
    written++;
  }
  try { await verifySnapshot(client, snapshot, (options.now ?? Date.now)()); }
  catch { throw new Error(`Restore wrote ${written} records but read verification has not passed. No cleanup/deletes performed; retry the verify command after KV propagation.`); }
  return result;
}

export function backupRestClient(accountId: string, token: string, namespaceId: string, fetchImpl: typeof fetch = fetch): BackupClient {
  if (!ID.test(accountId) || !ID.test(namespaceId) || !token) throw new Error('Cloudflare account/namespace IDs and token are required');
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`;
  const call = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const response = await fetchImpl(base + path, { ...init, signal: AbortSignal.timeout(30_000), redirect: 'manual', headers: { Authorization: `Bearer ${token}`, ...init.headers } });
    if (response.status >= 300 && response.status < 400) throw new Error('Cloudflare API redirect refused');
    return response;
  };
  return {
    async list(cursor) {
      const response = await call(`/keys?limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      const body = await response.json() as { success: boolean; result: KeyRecord[]; result_info?: { cursor?: string } };
      if (!response.ok || !body.success) throw new Error(`KV list failed (${response.status}); no values logged`);
      return { keys: body.result, cursor: body.result_info?.cursor };
    },
    async get(name) {
      const response = await call(`/values/${encodeURIComponent(name)}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`KV value read failed (${response.status}); no key/value logged`);
      const expiration = response.headers.get('expiration');
      if (expiration !== null && !/^\d+$/.test(expiration)) throw new Error('Invalid KV expiration response');
      return { value: new Uint8Array(await response.arrayBuffer()), ...(expiration !== null && { expiration: Number(expiration) }) };
    },
    async put(entry) {
      const form = new FormData();
      form.set('value', new Blob([Uint8Array.from(bytes(entry.value_base64))], { type: 'application/octet-stream' }));
      if (entry.metadata !== undefined) form.set('metadata', JSON.stringify(entry.metadata));
      const response = await call(`/values/${encodeURIComponent(entry.name)}${entry.expiration !== undefined ? `?expiration=${entry.expiration}` : ''}`, { method: 'PUT', body: form });
      const body = await response.json() as { success?: boolean };
      if (!response.ok || !body.success) throw new Error(`KV write failed (${response.status}); rerun verification, not restore; no data logged`);
    },
  };
}

async function main(): Promise<void> {
  const [command, first, second, ...flags] = process.argv.slice(2);
  if (!['export', 'restore', 'verify'].includes(command ?? '') || !first || !second || flags.some((flag) => !['--apply', '--isolated-target'].includes(flag))
    || (command !== 'restore' && flags.length)) throw new Error('usage: node apps/worker/scripts/kv-backup.ts export <source-namespace> <new-file> | restore <file> <different-empty-target> [--apply --isolated-target] | verify <file> <target>');
  const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: token, AGENTDRIVE_BACKUP_KEY: key } = process.env;
  if (!accountId || !token || !key) throw new Error('Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and AGENTDRIVE_BACKUP_KEY in the environment');
  bytes(key, 32);
  const fs = await import('node:fs/promises');
  if (command === 'export') {
    const snapshot = await exportSnapshot(backupRestClient(accountId, token, first), accountId, first);
    await fs.writeFile(second, await sealBackup(snapshot, key), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ exported: snapshot.entries.length, encrypted: true, output: second, permission: '0600', snapshot: 'quiescent-source required; not atomic' }));
  } else {
    const snapshot = await openBackup(await fs.readFile(first, 'utf8'), key);
    if (snapshot.account_id !== accountId) throw new Error('Backup account differs; cross-account restore is unsupported');
    if (snapshot.source_namespace === second) throw new Error('Refusing in-place restore/verification; choose a different namespace');
    const client = backupRestClient(accountId, token, second);
    console.log(JSON.stringify(command === 'verify' ? await verifySnapshot(client, snapshot)
      : await restoreSnapshot(client, snapshot, second, { apply: flags.includes('--apply'), isolatedTarget: flags.includes('--isolated-target') })));
  }
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('kv-backup.ts')) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : 'KV backup failed'); process.exitCode = 1; });
}
