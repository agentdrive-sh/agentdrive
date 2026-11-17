# ADR-0006: Envelope encryption with versioned KEK

**Status:** Accepted — 2026-05-19

## Context

File content sits in R2 (the AgentDrive shared bucket) or in a customer bucket via the `BucketDriver` indirection (ADR-0005). Without encryption-at-rest, a leak at the storage layer leaks plaintext. The S3-HMAC driver path is particularly sensitive: the customer's bucket may have IAM policies we don't audit, and the worker should not be required to trust the customer's at-rest encryption.

Naïve "use a single static key for everything" creates a key-rotation nightmare: a compromised key invalidates every blob, and you can't rotate without re-encrypting the entire corpus offline. We need per-blob keys with a rotation story that lets the system keep reading old blobs while new blobs land under the new key.

A second risk discovered during the v1 audit (`Codex tension T-E2`): if blob keys derive from `TOKEN_SIGNING_SECRET`, then rotating the share-token HMAC secret would invalidate every encrypted blob in the system — a foot-gun nobody would expect when running a routine token-secret rotation.

## Decision

Use **envelope encryption** with a versioned **Key Encryption Key (KEK)** root and **per-blob Data Encryption Keys (DEKs)** derived via HKDF.

Three Worker secrets carry the rotation state:

- `BUCKET_KEK_ROOT` — current KEK root (raw bytes).
- `BUCKET_KEK_VERSION` — integer; the version stamped into headers of newly-encrypted blobs.
- `BUCKET_KEK_ROOT_PREVIOUS` — JSON map `{ "<version-int>": "<hex-encoded-key>", ... }` of older KEK roots, kept until every blob written under them has been rotated forward.

For each write, the worker:

1. Generates a random per-blob salt.
2. Derives a DEK via `HKDF(BUCKET_KEK_ROOT, salt)`.
3. Encrypts the blob with AES-GCM using the DEK.
4. Stamps a header into the ciphertext: `{ kek_version, salt, iv, auth_tag }`.

For reads, the worker parses the header, looks up the KEK by `kek_version` in either the current root or the `PREVIOUS` map, re-derives the DEK, and decrypts.

Rotation is a procedure documented in `apps/worker/src/env.ts` and in the maintainers' operations runbook:

1. `wrangler secret put BUCKET_KEK_VERSION` to the new version (e.g. 2).
2. `wrangler secret put BUCKET_KEK_ROOT` to the new key.
3. `wrangler secret put BUCKET_KEK_ROOT_PREVIOUS '{"1":"<old-hex>"}'`.
4. Either lazy-rotate (re-encrypt on next write) or run a migration script.

**Hard constraint** (per the T-E2 audit finding): `BUCKET_KEK_ROOT` is never derived from `TOKEN_SIGNING_SECRET`. The two secret-rotation paths are independent.

## Consequences

**Easier:**

- KEK rotation is a three-secret rotation, not an offline re-encrypt.
- Compromise of one KEK version doesn't invalidate blobs encrypted under newer versions.
- Per-blob DEKs mean a leaked DEK only exposes one blob.
- The driver (ADR-0005) sees ciphertext + key id only. The customer bucket cannot derive worker secrets from anything it stores.

**Harder:**

- Worker holds the unwrap path. This is **not customer-managed encryption** — copy must never call it CMEK. Real CMEK is on the v1.5 roadmap and requires the customer to hold the KEK.
- Adding a new KEK version requires updating two secrets atomically. Wrangler dashboard does not have transactions; the runbook orders the writes to keep the old version readable through the cutover.
- The cipher format is now part of the storage contract. Changing it (e.g. moving from AES-GCM to ChaCha20-Poly1305) means writing both versions and migrating old blobs.

## Alternatives considered

- **One static key per org.** Simpler. Loses rotation; loses blast-radius containment.
- **Customer-managed keys (CMK) from day one.** Right end-state for Enterprise, wrong end-state for v1. Customers don't have a KMS at the indie / Team tier.
- **R2's built-in server-side encryption only.** Doesn't apply to S3-compat customer buckets. Inconsistent threat model across providers.
- **Encrypt with a key derived from `TOKEN_SIGNING_SECRET`.** Rejected by the T-E2 audit — couples two independent rotation lifecycles.

## References

- `apps/worker/src/services/envelope-encryption.ts` — the HKDF + AES-GCM implementation.
- `apps/worker/src/env.ts` — `BUCKET_KEK_*` secret declarations + rotation runbook.
- ADR-0005 — driver layer that sits below this.
