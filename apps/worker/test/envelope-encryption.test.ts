import { describe, it, expect } from 'vitest';
import {
  encrypt,
  decrypt,
  decryptText,
  parseHeader,
  kekConfigFromEnv,
  EnvelopeDecryptError,
  ENVELOPE_HEADER_LEN,
  ENVELOPE_MAGIC,
  type KekConfig,
} from '../src/services/envelope-encryption.js';

// Phase 4 / T-E2 — envelope encryption with kek_version-aware rotation.
//
// Contract under test:
//   - encrypt/decrypt round-trip preserves the plaintext byte-for-byte.
//   - Tampered ciphertext is rejected.
//   - Wrong kek_version cleanly rejected with a useful error.
//   - Dual-read rotation: a blob encrypted under (kek_v1) decrypts after
//     rotation to v2 IFF v1 is in the previousKeks map.
//   - Header layout matches the documented wire format.
//   - kekConfigFromEnv parses BUCKET_KEK_ROOT_PREVIOUS JSON.

// 64-hex = 256-bit key. Test keys, not production.
const KEK_V1 =
  '00112233445566778899aabbccddeeff' +
  '00112233445566778899aabbccddeeff';
const KEK_V2 =
  'ffeeddccbbaa99887766554433221100' +
  'ffeeddccbbaa99887766554433221100';
const KEK_V3 =
  '0102030405060708090a0b0c0d0e0f10' +
  '1112131415161718191a1b1c1d1e1f20';

function v1Config(): KekConfig {
  return { currentKekHex: KEK_V1, currentVersion: 1 };
}

function v2WithPrevious(): KekConfig {
  return { currentKekHex: KEK_V2, currentVersion: 2, previousKeks: { 1: KEK_V1 } };
}

describe('encrypt + decrypt round-trip', () => {
  it('round-trips plaintext text', async () => {
    const blob = await encrypt('hello world', v1Config());
    const out = await decryptText(blob, v1Config());
    expect(out).toBe('hello world');
  });

  it('round-trips a 64 KiB binary payload', async () => {
    const buf = new Uint8Array(64 * 1024);
    for (let i = 0; i < buf.length; i++) buf[i] = (i * 7) & 0xff;
    const blob = await encrypt(buf, v1Config());
    const out = await decrypt(blob, v1Config());
    expect(out.length).toBe(buf.length);
    for (let i = 0; i < buf.length; i++) expect(out[i]).toBe(buf[i]);
  });

  it('two encryptions of the same plaintext produce different ciphertexts (random salt/IV)', async () => {
    const a = await encrypt('same input', v1Config());
    const b = await encrypt('same input', v1Config());
    expect(a.length).toBe(b.length);
    // Magic + kek_version bytes match; salt + IVs + ciphertext differ.
    expect(a.slice(0, 8)).toEqual(b.slice(0, 8));
    expect(a.slice(8)).not.toEqual(b.slice(8));
  });
});

describe('header layout', () => {
  it('starts with the ADE1 magic + kek_version 1 in big-endian', async () => {
    const blob = await encrypt('hi', v1Config());
    expect(blob.length).toBeGreaterThanOrEqual(ENVELOPE_HEADER_LEN);
    expect(blob.slice(0, 4)).toEqual(ENVELOPE_MAGIC);
    // kek_version at bytes 4..8
    expect(blob[4]).toBe(0);
    expect(blob[5]).toBe(0);
    expect(blob[6]).toBe(0);
    expect(blob[7]).toBe(1);
  });

  it('parseHeader extracts the kek_version and IV lengths', async () => {
    const blob = await encrypt('hi', { currentKekHex: KEK_V1, currentVersion: 42 });
    const header = parseHeader(blob);
    expect(header.kekVersion).toBe(42);
    expect(header.salt.length).toBe(16);
    expect(header.wrapIv.length).toBe(12);
    expect(header.payloadIv.length).toBe(12);
    expect(header.wrappedDek.length).toBe(48);
    expect(header.payloadStart).toBe(ENVELOPE_HEADER_LEN);
  });

  it('parseHeader rejects a blob without the magic prefix', () => {
    const fake = new Uint8Array(ENVELOPE_HEADER_LEN + 16);
    expect(() => parseHeader(fake)).toThrow(EnvelopeDecryptError);
  });

  it('parseHeader rejects a blob shorter than the header', () => {
    expect(() => parseHeader(new Uint8Array(50))).toThrow(EnvelopeDecryptError);
  });
});

describe('tamper detection', () => {
  it('rejects payload tampering with EnvelopeDecryptError', async () => {
    const blob = await encrypt('top secret', v1Config());
    // Flip a single byte in the payload region.
    blob[blob.length - 1] ^= 0x01;
    await expect(decrypt(blob, v1Config())).rejects.toBeInstanceOf(EnvelopeDecryptError);
  });

  it('rejects wrapped-DEK tampering with EnvelopeDecryptError', async () => {
    const blob = await encrypt('top secret', v1Config());
    // Flip a byte inside the wrapped DEK (offset 36..84).
    blob[40] ^= 0x10;
    await expect(decrypt(blob, v1Config())).rejects.toBeInstanceOf(EnvelopeDecryptError);
  });

  it('rejects salt tampering with EnvelopeDecryptError', async () => {
    const blob = await encrypt('top secret', v1Config());
    // Flip a byte in the salt region (offset 8..24).
    blob[10] ^= 0x80;
    await expect(decrypt(blob, v1Config())).rejects.toBeInstanceOf(EnvelopeDecryptError);
  });
});

describe('wrong-key rejection', () => {
  it('decrypting v1 ciphertext with the wrong KEK throws', async () => {
    const blob = await encrypt('secret', v1Config());
    const wrong: KekConfig = { currentKekHex: KEK_V3, currentVersion: 1 };
    await expect(decrypt(blob, wrong)).rejects.toBeInstanceOf(EnvelopeDecryptError);
  });

  it('decrypting v1 ciphertext after a rotation without previousKeks throws with a clear error', async () => {
    const blob = await encrypt('secret', v1Config());
    const v2Only: KekConfig = { currentKekHex: KEK_V2, currentVersion: 2 };
    await expect(decrypt(blob, v2Only)).rejects.toThrow(/no KEK available for kek_version=1/);
  });
});

describe('dual-read rotation', () => {
  it('v1 blobs decrypt under a v2-current config when v1 is in previousKeks', async () => {
    const blob = await encrypt('history', v1Config());
    const out = await decryptText(blob, v2WithPrevious());
    expect(out).toBe('history');
  });

  it('v2-encrypted blobs decrypt cleanly under the v2 config', async () => {
    const blob = await encrypt('new world', v2WithPrevious());
    const header = parseHeader(blob);
    expect(header.kekVersion).toBe(2);
    const out = await decryptText(blob, v2WithPrevious());
    expect(out).toBe('new world');
  });

  it('a 3-version config decrypts blobs from any of the listed versions', async () => {
    const v1Blob = await encrypt('v1 data', v1Config());
    const v2Blob = await encrypt('v2 data', { currentKekHex: KEK_V2, currentVersion: 2 });
    const v3Config: KekConfig = {
      currentKekHex: KEK_V3,
      currentVersion: 3,
      previousKeks: { 1: KEK_V1, 2: KEK_V2 },
    };
    expect(await decryptText(v1Blob, v3Config)).toBe('v1 data');
    expect(await decryptText(v2Blob, v3Config)).toBe('v2 data');
  });

  it('rotating without listing the prior version surfaces the missing-version error eagerly', async () => {
    const v1Blob = await encrypt('v1 data', v1Config());
    const v2NoBackfill: KekConfig = {
      currentKekHex: KEK_V2,
      currentVersion: 2,
      previousKeks: { 99: KEK_V3 },
    };
    await expect(decrypt(v1Blob, v2NoBackfill)).rejects.toThrow(/kek_version=1/);
  });
});

describe('kekConfigFromEnv', () => {
  it('returns null when BUCKET_KEK_ROOT is unset', () => {
    expect(kekConfigFromEnv({})).toBeNull();
  });

  it('defaults BUCKET_KEK_VERSION to 1 when unset', () => {
    const cfg = kekConfigFromEnv({ BUCKET_KEK_ROOT: KEK_V1 });
    expect(cfg).not.toBeNull();
    expect(cfg!.currentVersion).toBe(1);
    expect(cfg!.previousKeks).toBeUndefined();
  });

  it('parses BUCKET_KEK_VERSION', () => {
    const cfg = kekConfigFromEnv({ BUCKET_KEK_ROOT: KEK_V2, BUCKET_KEK_VERSION: '7' });
    expect(cfg!.currentVersion).toBe(7);
  });

  it('parses BUCKET_KEK_ROOT_PREVIOUS JSON into the previousKeks map', () => {
    const cfg = kekConfigFromEnv({
      BUCKET_KEK_ROOT: KEK_V2,
      BUCKET_KEK_VERSION: '2',
      BUCKET_KEK_ROOT_PREVIOUS: JSON.stringify({ 1: KEK_V1 }),
    });
    expect(cfg!.previousKeks).toEqual({ 1: KEK_V1 });
  });

  it('throws on malformed BUCKET_KEK_ROOT_PREVIOUS JSON', () => {
    expect(() =>
      kekConfigFromEnv({ BUCKET_KEK_ROOT: KEK_V1, BUCKET_KEK_ROOT_PREVIOUS: 'not-json' }),
    ).toThrow(/not valid JSON/);
  });

  it('drops non-integer keys from BUCKET_KEK_ROOT_PREVIOUS rather than crashing', () => {
    const cfg = kekConfigFromEnv({
      BUCKET_KEK_ROOT: KEK_V2,
      BUCKET_KEK_VERSION: '2',
      BUCKET_KEK_ROOT_PREVIOUS: JSON.stringify({ 1: KEK_V1, garbage: 'ignore-me' }),
    });
    expect(Object.keys(cfg!.previousKeks ?? {})).toEqual(['1']);
  });

  it('throws when BUCKET_KEK_VERSION is non-integer', () => {
    expect(() =>
      kekConfigFromEnv({ BUCKET_KEK_ROOT: KEK_V1, BUCKET_KEK_VERSION: 'oops' }),
    ).toThrow(/positive integer/);
  });
});
