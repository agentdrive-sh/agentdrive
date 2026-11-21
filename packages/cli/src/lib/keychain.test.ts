import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, mkdtempSync } from 'node:fs';
import { hostname, tmpdir, userInfo } from 'node:os';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { join } from 'node:path';
import { loadDek, purgeKeychain } from './keychain.js';

const SCRYPT = { N: 1 << 14, maxmem: 64 * 1024 * 1024 };
type Envelope = { v: 1 | 2; salt: string; iv: string; tag: string; ct: string };

function kek(secret: string, salt: string): Buffer {
  return scryptSync(`${hostname()}|${userInfo().username}|${secret}`, Buffer.from(salt, 'base64'), 32, SCRYPT);
}

function wrap(plaintext: Buffer, secret: string, v: 1 | 2): Envelope {
  const salt = randomBytes(16).toString('base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', kek(secret, salt), iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { v, salt, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

function unwrapWith(blob: Envelope, secret: string): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', kek(secret, blob.salt), Buffer.from(blob.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(blob.ct, 'base64')), decipher.final()]);
}

describe('keychain', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'adrive-keychain-'));
    path = join(dir, 'keychain.bin');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('creates a fresh DEK on first use and persists it', async () => {
    const a = await loadDek('agentdrive_live_aaa_test_key_xyz', path);
    expect(a.length).toBe(32);
    const onDisk = await fs.readFile(path, 'utf8');
    const parsed = JSON.parse(onDisk);
    expect(parsed.v).toBe(1); // Old clients must not treat this as missing.
    expect(parsed.keyring_v2.v).toBe(2);
    expect(typeof parsed.ct).toBe('string');
    expect(typeof parsed.salt).toBe('string');
  });

  it('returns the same DEK across calls with the same API key', async () => {
    const a = await loadDek('agentdrive_live_xxx_same_key_zzz', path);
    const b = await loadDek('agentdrive_live_xxx_same_key_zzz', path);
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it('refuses to migrate a legacy keychain with the wrong API key without overwriting it', async () => {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(`${hostname()}|${userInfo().username}|agentdrive_live_correct_key_value`, salt, 32, { N: 1 << 14, maxmem: 64 * 1024 * 1024 });
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(randomBytes(32)), cipher.final()]);
    const original = JSON.stringify({ v: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') });
    await fs.writeFile(path, original, { mode: 0o600 });
    await expect(loadDek('agentdrive_live_wrong_key_value_zz', path)).rejects.toThrow();
    expect(await fs.readFile(path, 'utf8')).toBe(original);
  });

  it('keeps a new keychain usable when login credentials change', async () => {
    const first = await loadDek('agentdrive_live_before', path);
    expect((await loadDek('agentdrive_live_after', path)).equals(first)).toBe(true);
    expect((await fs.stat(path)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(`${path}.protector`)).mode & 0o777).toBe(0o600);
  });

  it('stores no copy of the DEK that the API key unwraps, only a well-formed v1 decoy old clients fail on', async () => {
    const apiKey = 'agentdrive_live_legacy_reader';
    await loadDek(apiKey, path);
    const blob = JSON.parse(await fs.readFile(path, 'utf8'));
    expect(blob.v).toBe(1);
    expect([blob.salt, blob.iv, blob.tag, blob.ct].map((f: string) => Buffer.from(f, 'base64').length)).toEqual([16, 12, 16, 32]);
    expect(() => unwrapWith(blob, apiKey)).toThrow(/authenticate/);
  });

  // The layout CLI 1.3.4 to 1.5.1 write: the DEK wrapped under the API key beside keyring_v2.
  async function earlierKeychain(apiKey: string): Promise<{ dek: Buffer; raw: string }> {
    const dek = randomBytes(32);
    const protector = randomBytes(32).toString('base64');
    await fs.writeFile(`${path}.protector`, protector, { mode: 0o600 });
    const ring = Buffer.from(JSON.stringify({ dek: dek.toString('base64'), legacy: [] }), 'utf8');
    const raw = JSON.stringify({ ...wrap(dek, apiKey, 1), keyring_v2: wrap(ring, protector, 2) });
    await fs.writeFile(path, raw, { mode: 0o600 });
    return { dek, raw };
  }

  it('replaces the API-key copy an earlier CLI left beside keyring_v2 with a decoy, once', async () => {
    const apiKey = 'agentdrive_live_earlier_cli';
    const { dek, raw } = await earlierKeychain(apiKey);
    expect((await loadDek(apiKey, path)).equals(dek)).toBe(true);
    const after = await fs.readFile(path, 'utf8');
    const blob = JSON.parse(after);
    expect(blob.v).toBe(1);
    expect(() => unwrapWith(blob, apiKey)).toThrow(/authenticate/);
    expect(JSON.stringify(blob.keyring_v2)).toBe(JSON.stringify(JSON.parse(raw).keyring_v2));
    expect((await fs.stat(path)).mode & 0o777).toBe(0o600);
    expect((await loadDek('agentdrive_live_other', path)).equals(dek)).toBe(true);
    expect(await fs.readFile(path, 'utf8')).toBe(after);
  });

  it('migrates a v1-only keychain into keyring_v2 behind a decoy', async () => {
    const apiKey = 'agentdrive_live_v1_only';
    const dek = randomBytes(32);
    await fs.writeFile(path, JSON.stringify(wrap(dek, apiKey, 1)), { mode: 0o600 });
    expect((await loadDek(apiKey, path)).equals(dek)).toBe(true);
    const blob = JSON.parse(await fs.readFile(path, 'utf8'));
    expect(blob.keyring_v2.v).toBe(2);
    expect(() => unwrapWith(blob, apiKey)).toThrow(/authenticate/);
    expect((await loadDek('agentdrive_live_other', path)).equals(dek)).toBe(true);
  });

  it('concurrent loads of an earlier keychain all get its DEK and leave keyring_v2 as it was', async () => {
    const apiKey = 'agentdrive_live_concurrent';
    const { dek, raw } = await earlierKeychain(apiKey);
    const keys = await Promise.all(Array.from({ length: 4 }, () => loadDek(apiKey, path)));
    expect(keys.every((key) => key.equals(dek))).toBe(true);
    const blob = JSON.parse(await fs.readFile(path, 'utf8'));
    expect(() => unwrapWith(blob, apiKey)).toThrow(/authenticate/);
    expect(JSON.stringify(blob.keyring_v2)).toBe(JSON.stringify(JSON.parse(raw).keyring_v2));
    expect((await fs.readdir(dir)).sort()).toEqual(['keychain.bin', 'keychain.bin.protector']);
  });

  it('keeps the API-key copy while keyring_v2 cannot be opened', async () => {
    const apiKey = 'agentdrive_live_no_protector';
    const { raw } = await earlierKeychain(apiKey);
    await fs.unlink(`${path}.protector`);
    await expect(loadDek(apiKey, path)).rejects.toThrow(/protector is missing/);
    expect(await fs.readFile(path, 'utf8')).toBe(raw);
  });

  it('never recreates a missing protector for an existing keychain', async () => {
    await loadDek('agentdrive_live_before', path);
    const original = await fs.readFile(path, 'utf8');
    await fs.unlink(`${path}.protector`);
    await expect(loadDek('agentdrive_live_after', path)).rejects.toThrow(/protector is missing/);
    expect(await fs.readFile(path, 'utf8')).toBe(original);
    await expect(fs.access(`${path}.protector`)).rejects.toThrow();
  });

  it('purgeKeychain removes the file', async () => {
    await loadDek('agentdrive_live_xxx_purge_test_yyy', path);
    await purgeKeychain(path);
    await expect(fs.access(path)).rejects.toThrow();
  });
});
