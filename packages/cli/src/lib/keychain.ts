import { promises as fs } from 'node:fs';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { hostname, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { configDir } from './config.js';

// Software keychain, not an OS/hardware-backed keychain. The random local
// protector and this wrapped keyring must both be backed up; recovery still
// requires the original hostname/user identity. Login credentials are not
// encryption key material in v2. An attacker
// with this user's files and machine identity can still recover local keys.
// Existing v1 keyrings migrate only after successfully unwrapping with the old
// API key, before logout or credential replacement can discard that credential.
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;
const SCRYPT_OPTIONS = { N: 1 << 14, maxmem: 64 * 1024 * 1024 };

interface StoredBlob {
  v: 1 | 2;
  salt: string;
  iv: string;
  tag: string;
  ct: string;
  keyring_v2?: StoredBlob;
}
interface Keyring {
  dek: string;
  // Pre-keychain ciphertext was derived directly from the API key. Retain
  // those derived keys encrypted here, never the former API credentials.
  legacy: string[];
}

export function keychainPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), 'keychain.bin');
}

function protectorPath(path: string): string {
  return `${path}.protector`;
}

export function deriveLegacyWorkspaceKey(apiKey: string): Buffer {
  return scryptSync(apiKey, Buffer.from('agentdrive.privacy.v0', 'utf8'), KEY_LENGTH, SCRYPT_OPTIONS);
}

function deriveKek(secret: string, salt: Buffer): Buffer {
  return scryptSync(`${hostname()}|${userInfo().username}|${secret}`, salt, KEY_LENGTH, SCRYPT_OPTIONS);
}

function decode(value: unknown, length?: number): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Invalid key encoding');
  const bytes = Buffer.from(value, 'base64');
  if ((length !== undefined && bytes.length !== length) || bytes.toString('base64') !== value) throw new Error('Invalid key length or encoding');
  return bytes;
}

async function readBlob(path: string): Promise<StoredBlob | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  try {
    const blob = JSON.parse(raw) as StoredBlob;
    const validate = (value: StoredBlob) => {
      if (!value || (value.v !== 1 && value.v !== 2)) throw new Error('Unsupported version');
      decode(value.salt, SALT_LENGTH);
      decode(value.iv, IV_LENGTH);
      decode(value.tag, TAG_LENGTH);
      decode(value.ct);
    };
    validate(blob);
    if (blob.keyring_v2) {
      validate(blob.keyring_v2);
      if (blob.keyring_v2.v !== 2) throw new Error('Unsupported keyring');
    }
    return blob;
  } catch {
    throw new Error(`AgentDrive keychain is damaged or unsupported: ${path}. Restore a backup; do not delete it or replace credentials.`);
  }
}

// Publish complete files atomically. First use links exclusively so competing
// capture processes converge on the same protector/DEK instead of overwriting it.
async function publish(path: string, data: string, replace = false): Promise<boolean> {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, data, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    if (replace) {
      await fs.rename(temp, path);
      return true;
    }
    try {
      await fs.link(temp, path);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw err;
    }
  } finally {
    await fs.unlink(temp).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; });
  }
}

async function localProtector(path: string, create: boolean): Promise<string> {
  const file = protectorPath(path);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    if (!create) throw new Error(`AgentDrive keychain protector is missing: ${file}. Restore it with keychain.bin from the same backup.`);
    await publish(file, randomBytes(KEY_LENGTH).toString('base64'));
    raw = await fs.readFile(file, 'utf8');
  }
  try {
    decode(raw, KEY_LENGTH);
    return raw;
  } catch {
    throw new Error(`AgentDrive keychain protector is damaged: ${file}. Restore a backup; it will not be overwritten.`);
  }
}

function unwrap(blob: StoredBlob, secret: string): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', deriveKek(secret, decode(blob.salt, SALT_LENGTH)), decode(blob.iv, IV_LENGTH));
  decipher.setAuthTag(decode(blob.tag, TAG_LENGTH));
  return Buffer.concat([decipher.update(decode(blob.ct)), decipher.final()]);
}

function wrapBytes(plaintext: Buffer, secret: string, version: 1 | 2): StoredBlob {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', deriveKek(secret, salt), iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { v: version, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

function parseKeyring(raw: Buffer): Keyring {
  const ring = JSON.parse(raw.toString('utf8')) as Keyring;
  decode(ring.dek, KEY_LENGTH);
  if (!Array.isArray(ring.legacy)) throw new Error('Invalid legacy keyring');
  for (const key of ring.legacy) decode(key, KEY_LENGTH);
  return ring;
}

async function loadKeyring(apiKey: string, path: string): Promise<Keyring> {
  const blob = await readBlob(path);
  const localRing = blob?.v === 2 ? blob : blob?.keyring_v2;
  if (localRing) {
    const protector = await localProtector(path, false);
    return parseKeyring(unwrap(localRing, protector));
  }
  // Never create a replacement key when v1 authentication fails.
  const dek = blob ? unwrap(blob, apiKey) : randomBytes(KEY_LENGTH);
  if (dek.length !== KEY_LENGTH) throw new Error('Invalid AgentDrive keychain DEK');
  const ring = { dek: dek.toString('base64'), legacy: [deriveLegacyWorkspaceKey(apiKey).toString('base64')] };
  const protector = await localProtector(path, true);
  // Old releases overwrite unknown versions. Keep a v1-readable envelope so
  // cached old clients retain this DEK or reject a changed credential safely;
  // new clients use the independent encrypted v2 keyring alongside it.
  const compatible = blob ?? wrapBytes(dek, apiKey, 1);
  const stored = { ...compatible, keyring_v2: wrapBytes(Buffer.from(JSON.stringify(ring), 'utf8'), protector, 2) };
  if (!(await publish(path, JSON.stringify(stored), !!blob))) return loadKeyring(apiKey, path);
  return ring;
}

export async function loadDek(apiKey: string, path: string = keychainPath()): Promise<Buffer> {
  return decode((await loadKeyring(apiKey, path)).dek, KEY_LENGTH);
}

export async function loadDecryptionKeys(apiKey: string, path: string = keychainPath()): Promise<Buffer[]> {
  const ring = await loadKeyring(apiKey, path);
  return [decode(ring.dek, KEY_LENGTH), ...ring.legacy.map((key) => decode(key, KEY_LENGTH))];
}

// Must succeed before an auth command can discard the last v1 credential.
// Even a pre-keychain install may have v0 ciphertext: preserve its derived key
// while the credential still exists. A fresh install without credentials does
// not create key material until first encryption.
export async function preserveKeychain(apiKey?: string, path: string = keychainPath()): Promise<void> {
  const blob = await readBlob(path);
  if (!blob && !apiKey) return;
  if (blob?.v === 1 && !blob.keyring_v2 && !apiKey) throw new Error('AgentDrive keychain needs the original API key to migrate. Restore the original config before logging in; key material was preserved.');
  await loadKeyring(apiKey ?? '', path);
}

export async function purgeKeychain(path: string = keychainPath()): Promise<void> {
  // Deliberate key destruction only; logout must never call this.
  await Promise.all([path, protectorPath(path)].map(async (file) => {
    try { await fs.unlink(file); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
  }));
}
