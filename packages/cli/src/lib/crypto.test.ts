import { describe, it, expect } from 'vitest';
import { encryptContent, decryptContent, isEncrypted } from './crypto.js';

const KEY = 'agentdrive_live_test_key_with_enough_entropy_xyz';

describe('crypto', () => {
  it('round-trips utf8 content', () => {
    const original = 'hello — αβγ — 🌍';
    const ct = encryptContent(KEY, original);
    expect(isEncrypted(ct)).toBe(true);
    expect(ct.startsWith('agentdrive-encrypted:v0:')).toBe(true);
    expect(decryptContent(KEY, ct)).toBe(original);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const a = encryptContent(KEY, 'same');
    const b = encryptContent(KEY, 'same');
    expect(a).not.toBe(b);
    expect(decryptContent(KEY, a)).toBe('same');
    expect(decryptContent(KEY, b)).toBe('same');
  });

  it('rejects decryption with a different key', () => {
    const ct = encryptContent(KEY, 'secret');
    expect(() => decryptContent('a_different_key_value_with_entropy_zzz', ct)).toThrow();
  });

  it('rejects tampered ciphertext via the GCM auth tag', () => {
    const ct = encryptContent(KEY, 'secret');
    const prefix = 'agentdrive-encrypted:v0:';
    const inner = JSON.parse(Buffer.from(ct.slice(prefix.length), 'base64').toString('utf8'));
    const cipherBuf = Buffer.from(inner.ciphertext, 'base64');
    cipherBuf[0] = cipherBuf[0]! ^ 0xff;
    inner.ciphertext = cipherBuf.toString('base64');
    const tampered = prefix + Buffer.from(JSON.stringify(inner)).toString('base64');
    expect(() => decryptContent(KEY, tampered)).toThrow();
  });

  it('isEncrypted is false for plaintext', () => {
    expect(isEncrypted('hello world')).toBe(false);
    expect(isEncrypted('')).toBe(false);
  });

  it('refuses to decrypt plaintext', () => {
    expect(() => decryptContent(KEY, 'plain')).toThrow(/not AgentDrive-encrypted/);
  });
});
