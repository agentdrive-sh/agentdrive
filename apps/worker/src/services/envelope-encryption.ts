// Phase 4 / T-E2 envelope encryption.
//
// Two-tier AES-GCM:
//   1. Per-blob DEK (256-bit, random). Encrypts the payload.
//   2. Per-blob wrapping key, derived as HKDF(BUCKET_KEK_ROOT, salt).
//      Encrypts the DEK ("wrapped DEK").
//
// Every ciphertext carries a header binding it to a specific kek_version,
// so rotation is lazy + zero-downtime: write new blobs against v2 while
// v1 stays decryptable until they're re-encrypted. The salt is unique per
// blob — same KEK never produces the same wrapping key twice.
//
// Wire format (all big-endian where multi-byte):
//
//   off  bytes  field
//   ---  -----  ---------------------------------------------------
//   0    4      magic "ADE1" (AgentDrive Envelope v1)
//   4    4      kek_version uint32
//   8    16     HKDF salt
//   24   12     wrap_iv (AES-GCM nonce for wrapping the DEK)
//   36   48     wrapped DEK (32-byte DEK + 16-byte GCM tag)
//   84   12     payload_iv (AES-GCM nonce for the payload)
//   96   N      payload ciphertext + 16-byte GCM tag
//
// Total header: 96 bytes. Payload expansion: +16 GCM tag.
//
// Per CEO plan T-E2: NEVER derive BUCKET_KEK_ROOT from TOKEN_SIGNING_SECRET.
// Rotating the share-token secret must not invalidate every encrypted blob.

const MAGIC = new Uint8Array([0x41, 0x44, 0x45, 0x31]); // "ADE1"
const MAGIC_OFFSET = 0;
const KEK_VERSION_OFFSET = 4;
const SALT_OFFSET = 8;
const SALT_LEN = 16;
const WRAP_IV_OFFSET = 24;
const IV_LEN = 12;
const WRAPPED_DEK_OFFSET = 36;
const WRAPPED_DEK_LEN = 48; // 32 plaintext DEK + 16 GCM tag
const PAYLOAD_IV_OFFSET = 84;
const PAYLOAD_OFFSET = 96;

const DEK_LEN = 32;

export const ENVELOPE_HEADER_LEN = PAYLOAD_OFFSET;
export const ENVELOPE_MAGIC = MAGIC;

export interface KekConfig {
  // Hex-encoded high-entropy secret (≥32 bytes recommended).
  currentKekHex: string;
  // Current version stamped into new ciphertext headers.
  currentVersion: number;
  // Map of older versions -> hex KEK so existing blobs stay decryptable
  // during a rotation window.
  previousKeks?: Record<number, string>;
}

export class EnvelopeDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeDecryptError';
  }
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.replace(/\s+/g, '');
  if (normalized.length % 2 !== 0) {
    throw new Error('Invalid hex string (odd length)');
  }
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    out[i / 2] = parseInt(normalized.slice(i, i + 2), 16);
  }
  return out;
}

function writeUint32BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

function readUint32BE(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset]! << 24) |
    (buf[offset + 1]! << 16) |
    (buf[offset + 2]! << 8) |
    buf[offset + 3]!
  ) >>> 0;
}

async function deriveWrappingKey(kekRoot: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', kekRoot, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: new TextEncoder().encode('agentdrive/bucket-kek/v1'),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface EnvelopeConfig {
  /** Test override: skip the cryptographically-random source so tests can
   *  pin headers byte-for-byte. Never set in production. */
  rngOverride?: (bytes: Uint8Array) => void;
}

function fillRandom(buf: Uint8Array, opts?: EnvelopeConfig): void {
  if (opts?.rngOverride) {
    opts.rngOverride(buf);
    return;
  }
  crypto.getRandomValues(buf);
}

export async function encrypt(
  plaintext: Uint8Array | string,
  config: KekConfig,
  opts?: EnvelopeConfig,
): Promise<Uint8Array> {
  if (!config.currentKekHex) {
    throw new Error('encrypt: missing currentKekHex');
  }

  const kekRoot = hexToBytes(config.currentKekHex);
  const salt = new Uint8Array(SALT_LEN);
  const wrapIv = new Uint8Array(IV_LEN);
  const payloadIv = new Uint8Array(IV_LEN);
  const dek = new Uint8Array(DEK_LEN);
  fillRandom(salt, opts);
  fillRandom(wrapIv, opts);
  fillRandom(payloadIv, opts);
  fillRandom(dek, opts);

  const wrappingKey = await deriveWrappingKey(kekRoot, salt);
  const wrappedDekBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: wrapIv },
    wrappingKey,
    dek,
  );
  const wrappedDek = new Uint8Array(wrappedDekBuf);
  if (wrappedDek.length !== WRAPPED_DEK_LEN) {
    throw new Error(`unexpected wrapped DEK length ${wrappedDek.length}`);
  }

  const payloadKey = await crypto.subtle.importKey('raw', dek, 'AES-GCM', false, ['encrypt']);
  const plaintextBytes = typeof plaintext === 'string' ? new TextEncoder().encode(plaintext) : plaintext;
  const payloadCtBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: payloadIv },
    payloadKey,
    plaintextBytes,
  );
  const payloadCt = new Uint8Array(payloadCtBuf);

  const out = new Uint8Array(PAYLOAD_OFFSET + payloadCt.length);
  out.set(MAGIC, MAGIC_OFFSET);
  writeUint32BE(out, KEK_VERSION_OFFSET, config.currentVersion);
  out.set(salt, SALT_OFFSET);
  out.set(wrapIv, WRAP_IV_OFFSET);
  out.set(wrappedDek, WRAPPED_DEK_OFFSET);
  out.set(payloadIv, PAYLOAD_IV_OFFSET);
  out.set(payloadCt, PAYLOAD_OFFSET);

  return out;
}

export interface ParsedEnvelopeHeader {
  kekVersion: number;
  salt: Uint8Array;
  wrapIv: Uint8Array;
  wrappedDek: Uint8Array;
  payloadIv: Uint8Array;
  payloadStart: number;
}

export function parseHeader(blob: Uint8Array): ParsedEnvelopeHeader {
  if (blob.length < PAYLOAD_OFFSET) {
    throw new EnvelopeDecryptError('ciphertext too short for envelope header');
  }
  for (let i = 0; i < MAGIC.length; i++) {
    if (blob[i] !== MAGIC[i]) {
      throw new EnvelopeDecryptError('invalid envelope magic');
    }
  }
  return {
    kekVersion: readUint32BE(blob, KEK_VERSION_OFFSET),
    salt: blob.slice(SALT_OFFSET, SALT_OFFSET + SALT_LEN),
    wrapIv: blob.slice(WRAP_IV_OFFSET, WRAP_IV_OFFSET + IV_LEN),
    wrappedDek: blob.slice(WRAPPED_DEK_OFFSET, WRAPPED_DEK_OFFSET + WRAPPED_DEK_LEN),
    payloadIv: blob.slice(PAYLOAD_IV_OFFSET, PAYLOAD_IV_OFFSET + IV_LEN),
    payloadStart: PAYLOAD_OFFSET,
  };
}

export async function decrypt(blob: Uint8Array, config: KekConfig): Promise<Uint8Array> {
  const header = parseHeader(blob);

  const kekHex = config.currentVersion === header.kekVersion
    ? config.currentKekHex
    : config.previousKeks?.[header.kekVersion];
  if (!kekHex) {
    throw new EnvelopeDecryptError(
      `no KEK available for kek_version=${header.kekVersion} ` +
        `(current=${config.currentVersion}, previous=${Object.keys(config.previousKeks ?? {}).join(',') || 'none'})`,
    );
  }
  const kekRoot = hexToBytes(kekHex);
  const wrappingKey = await deriveWrappingKey(kekRoot, header.salt);

  let dek: ArrayBuffer;
  try {
    dek = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: header.wrapIv },
      wrappingKey,
      header.wrappedDek,
    );
  } catch {
    throw new EnvelopeDecryptError('failed to unwrap DEK — tampered header or wrong KEK');
  }

  const payloadKey = await crypto.subtle.importKey('raw', dek, 'AES-GCM', false, ['decrypt']);
  const payloadCt = blob.slice(header.payloadStart);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: header.payloadIv },
      payloadKey,
      payloadCt,
    );
  } catch {
    throw new EnvelopeDecryptError('failed to decrypt payload — tampered ciphertext');
  }
  return new Uint8Array(plaintext);
}

export async function decryptText(blob: Uint8Array, config: KekConfig): Promise<string> {
  const bytes = await decrypt(blob, config);
  return new TextDecoder().decode(bytes);
}

// Build a KekConfig from worker env vars. Returns null when KEK is not
// configured — callers can branch on that to keep plaintext storage for
// the default-bucket case in v1.
export function kekConfigFromEnv(env: {
  BUCKET_KEK_ROOT?: string;
  BUCKET_KEK_VERSION?: string;
  BUCKET_KEK_ROOT_PREVIOUS?: string;
}): KekConfig | null {
  if (!env.BUCKET_KEK_ROOT) return null;
  const version = env.BUCKET_KEK_VERSION ? Number.parseInt(env.BUCKET_KEK_VERSION, 10) : 1;
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`BUCKET_KEK_VERSION must be a positive integer, got: ${env.BUCKET_KEK_VERSION}`);
  }
  let previousKeks: Record<number, string> | undefined;
  if (env.BUCKET_KEK_ROOT_PREVIOUS) {
    try {
      const parsed = JSON.parse(env.BUCKET_KEK_ROOT_PREVIOUS) as Record<string, string>;
      previousKeks = {};
      for (const [k, v] of Object.entries(parsed)) {
        const versionNum = Number.parseInt(k, 10);
        if (!Number.isInteger(versionNum) || versionNum < 1) continue;
        previousKeks[versionNum] = v;
      }
    } catch {
      throw new Error('BUCKET_KEK_ROOT_PREVIOUS is not valid JSON');
    }
  }
  return {
    currentKekHex: env.BUCKET_KEK_ROOT,
    currentVersion: version,
    previousKeks,
  };
}
