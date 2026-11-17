import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { deriveLegacyWorkspaceKey, loadDek, loadDecryptionKeys } from './keychain.js';

// AgentDrive private-workspace encryption (v1).
//
// Sync API (`encryptContent` / `decryptContent`) keeps the legacy v0
// derivation: scrypt(apiKey, fixedSalt). Used by tests + any caller that
// can't await. The async API (`encryptContentAsync` / `decryptContentAsync`)
// uses the keychain-stored DEK from lib/keychain.ts — that's the path the
// real `adrive push` / `adrive pull` take.
//
// Why two paths: a published v0.2.x ciphertext on disk should still decrypt
// after the upgrade. The async path is opt-in and used for new writes.

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const ENCRYPTED_PREFIX = 'agentdrive-encrypted:v0:';

export function deriveWorkspaceKey(apiKey: string): Buffer {
  return deriveLegacyWorkspaceKey(apiKey);
}

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  tag: string;
}

function encryptWithKey(key: Buffer, plaintext: string | Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const buf = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const ciphertext = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload: EncryptedPayload = {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
  return ENCRYPTED_PREFIX + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

function decryptWithKey(key: Buffer, encoded: string): string {
  if (!isEncrypted(encoded)) {
    throw new Error('Content is not AgentDrive-encrypted.');
  }
  const payloadJson = Buffer.from(encoded.slice(ENCRYPTED_PREFIX.length), 'base64').toString('utf8');
  const payload = JSON.parse(payloadJson) as EncryptedPayload;
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
    throw new Error('Malformed encrypted payload.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function encryptContent(apiKey: string, plaintext: string | Buffer): string {
  return encryptWithKey(deriveWorkspaceKey(apiKey), plaintext);
}

export function decryptContent(apiKey: string, encoded: string): string {
  if (!isEncrypted(encoded)) {
    throw new Error('Content is not AgentDrive-encrypted.');
  }
  return decryptWithKey(deriveWorkspaceKey(apiKey), encoded);
}

export async function encryptContentAsync(apiKey: string, plaintext: string | Buffer): Promise<string> {
  const dek = await loadDek(apiKey);
  return encryptWithKey(dek, plaintext);
}

export async function decryptContentAsync(apiKey: string, encoded: string): Promise<string> {
  let keychainError: unknown;
  try {
    for (const key of await loadDecryptionKeys(apiKey)) {
      try { return decryptWithKey(key, encoded); }
      catch (err) { keychainError = err; }
    }
  } catch (err) {
    keychainError = err;
  }
  // Pre-keychain content can still be read even when a local keychain is
  // unavailable; legacy credentials retained in v2 cover prior API keys.
  try { return decryptWithKey(deriveWorkspaceKey(apiKey), encoded); }
  catch { throw keychainError; }
}

export function isEncrypted(content: string): boolean {
  return typeof content === 'string' && content.startsWith(ENCRYPTED_PREFIX);
}
