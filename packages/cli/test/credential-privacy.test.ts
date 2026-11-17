// Regression: launch audit BE-02 — credential replacement must preserve encrypted history.
// Found by /qa on 2026-11-16.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { hostname, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { cmdAuthLogin } from '../src/commands/auth-login.js';
import { cmdAuthLogout } from '../src/commands/auth-logout.js';
import { cmdInit } from '../src/commands/init.js';
import { ApiError, CliApiClient } from '../src/lib/api-client.js';
import { readConfig, writeConfig } from '../src/lib/config.js';
import { decryptContentAsync, encryptContent, encryptContentAsync } from '../src/lib/crypto.js';
import { keychainPath, loadDek } from '../src/lib/keychain.js';
import { pollAuth } from '../src/lib/poll-auth.js';

vi.mock('../src/lib/poll-auth.js', () => ({ pollAuth: vi.fn() }));
vi.mock('../src/lib/consent.js', () => ({ ensureCaptureConsent: vi.fn(async (config) => config) }));
vi.mock('../src/lib/wire-all.js', () => ({ wireInstalled: vi.fn(async () => []) }));
vi.mock('../src/lib/auto-context.js', () => ({ writeAllInstructions: vi.fn(async () => []) }));

const OLD = 'agentdrive_live_synthetic_original';
const NEW = 'agentdrive_live_synthetic_replacement';
let fixture: string;

async function legacyKeychain(): Promise<string> {
  const path = keychainPath();
  await fs.mkdir(join(fixture, 'agentdrive'), { recursive: true });
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(`${hostname()}|${userInfo().username}|${OLD}`, salt, 32, { N: 1 << 14, maxmem: 64 * 1024 * 1024 });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(randomBytes(32)), cipher.final()]);
  const raw = JSON.stringify({ v: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') });
  await fs.writeFile(path, raw, { mode: 0o600 });
  return raw;
}

beforeEach(async () => {
  fixture = await fs.mkdtemp(join(tmpdir(), 'agentdrive-credential-regression-'));
  vi.stubEnv('XDG_CONFIG_HOME', fixture);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.mocked(pollAuth).mockResolvedValue({ api_key: NEW, agent_id: 'ag_synthetic', org_id: 'org_synthetic' });
  await writeConfig({ api_url: 'https://synthetic.invalid', api_key: OLD, preferences: { auto_context: false, capture_artifacts: false, capture_transcripts: false, private_workspace: true, auto_wire: false } });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(fixture, { recursive: true, force: true });
});

describe('credential and encrypted-content lifecycle', () => {
  it('preserves existing private content across logout, login and subsequent capture', async () => {
    await legacyKeychain();
    const first = await encryptContentAsync(OLD, 'Original private task');
    await cmdAuthLogout({ yes: true });
    expect(await readConfig()).toBeNull();
    await cmdAuthLogin();
    expect((await readConfig())?.api_key).toBe(NEW);
    expect(await decryptContentAsync(NEW, first)).toBe('Original private task');
    const second = await encryptContentAsync(NEW, 'Next private task');
    expect(await decryptContentAsync(NEW, second)).toBe('Next private task');
  });

  it('retains pre-keychain v0 content across explicit credential replacement', async () => {
    await legacyKeychain();
    const content = encryptContent(OLD, 'Legacy private task');
    await cmdAuthLogin();
    expect(await decryptContentAsync(NEW, content)).toBe('Legacy private task');
  });

  it('preserves v0 ciphertext when logging out before a keychain ever existed', async () => {
    const content = encryptContent(OLD, 'Pre-keychain capture');
    await cmdAuthLogout({ yes: true });
    await cmdAuthLogin();
    expect(await decryptContentAsync(NEW, content)).toBe('Pre-keychain capture');
  });

  it('migrates the DEK before init replaces a rejected API key', async () => {
    await legacyKeychain();
    const content = await encryptContentAsync(OLD, 'Revoked credential content');
    vi.spyOn(CliApiClient.prototype, 'whoami').mockRejectedValue(new ApiError('rejected', 401));
    await cmdInit({ yes: true });
    expect((await readConfig())?.api_key).toBe(NEW);
    expect(await decryptContentAsync(NEW, content)).toBe('Revoked credential content');
  });

  it('does not replace credentials or damaged key material when keychain parsing fails', async () => {
    await legacyKeychain();
    await fs.writeFile(keychainPath(), '{damaged');
    await expect(cmdAuthLogin()).rejects.toThrow(/keychain/i);
    expect((await readConfig())?.api_key).toBe(OLD);
    expect(await fs.readFile(keychainPath(), 'utf8')).toBe('{damaged');
  });

  it('leaves original wrapped key and credentials intact when migration publication fails', async () => {
    const original = await legacyKeychain();
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('synthetic disk failure'));
    await expect(cmdAuthLogin()).rejects.toThrow(/synthetic disk failure/);
    expect((await readConfig())?.api_key).toBe(OLD);
    expect(await fs.readFile(keychainPath(), 'utf8')).toBe(original);
  });

  it('concurrent first captures choose one durable DEK', async () => {
    const keys = await Promise.all(Array.from({ length: 4 }, () => loadDek(OLD)));
    expect(keys.every((key) => key.equals(keys[0]!))).toBe(true);
    expect((await loadDek(NEW)).equals(keys[0]!)).toBe(true);
  });
});
