import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, mkdtempSync } from 'node:fs';
import { hostname, tmpdir, userInfo } from 'node:os';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { join } from 'node:path';
import { loadDek, purgeKeychain } from './keychain.js';

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

  it('keeps the outer envelope readable by pre-migration clients with the original credential', async () => {
    const apiKey = 'agentdrive_live_legacy_reader';
    const dek = await loadDek(apiKey, path);
    const blob = JSON.parse(await fs.readFile(path, 'utf8'));
    expect(blob.v).toBe(1);
    const salt = Buffer.from(blob.salt, 'base64');
    const key = scryptSync(`${hostname()}|${userInfo().username}|${apiKey}`, salt, 32, { N: 1 << 14, maxmem: 64 * 1024 * 1024 });
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
    expect(Buffer.concat([decipher.update(Buffer.from(blob.ct, 'base64')), decipher.final()]).equals(dek)).toBe(true);
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
