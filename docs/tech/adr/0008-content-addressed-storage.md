# ADR-0008: Content-addressed storage with sha256 dedup

**Status:** Accepted — 2026-05-15

## Context

Agents produce a lot of artifacts, and they re-produce a lot of *near-identical* artifacts. A plan written twice, a code patch refactored slightly, the same README copy-pasted into multiple workspaces. Storing each as a fresh blob doubles cost for no benefit.

Beyond cost: an artifact's identity is its content, not its name or path. Two workspaces that contain the same plan are storing the same thing. The substrate should treat them as the same.

A content-addressed scheme also gives us free integrity. A blob retrieved under its own hash either matches or has been tampered with — no separate checksum needed.

## Decision

R2 keys are `content/<sha256>`. Every blob is keyed by the lowercase hex sha256 of its plaintext bytes.

On write:

1. Hash the plaintext.
2. `r2.head(content/<hash>)` to check existence.
3. If absent, `r2.put` the (encrypted, per ADR-0006) blob.
4. Persist a `FileMeta` row in KV (`file:<ws_id>:<path>`) with `content_hash` pointing at the R2 key plus a `StorageLocator` carrying the bucket-config id (per ADR-0005).

A single hash can be referenced by many `FileMeta` rows across workspaces and orgs. The R2 object is immutable per hash; updates produce a new hash and a new `FileMeta` version (`file_ver:<ws_id>:<path>:<n>`).

Deletes today **do not** remove the R2 object. Ref-counting is on the v1.5 roadmap as part of the orphan-prevention work for Vectorize embeddings (which are also content-hash-keyed).

## Consequences

**Easier:**

- Free dedup. The 100th copy of a stable artifact costs metadata bytes, not blob bytes.
- Free integrity. Retrieving by hash + re-hashing on read detects bit rot or tampering.
- Free cache key. CDN, browser, in-process — content hashes are perfect cache keys.
- Embeddings are idempotent. The embedding for `content/<hash>` is the same regardless of which workspace wrote it; `embeddings.ts` deduplicates by content hash before calling Workers AI.

**Harder:**

- No "in-place edit" semantics — every change produces a new R2 object. Versions are explicit, not implicit. This is fine for our domain (artifacts, not databases) but would be wrong for a transactional system.
- Deletes don't free storage today. Orphan prevention requires ref-counting, scheduled for v1.5. The growth rate is bounded by *unique* content, not total writes, so this is an upper-bound problem we can carry.
- Hash collisions are theoretical for sha256 but the data model would not survive one. We accept the cryptographic-collision threat model.

## Alternatives considered

- **UUID or workspace-scoped key (`<ws_id>/<path>`).** No dedup, no integrity check, no cache-key win.
- **sha512 or blake3.** Bigger key surface for marginal collision resistance. sha256 is the right point on the curve given existing tooling.
- **Soft-delete + scheduled GC.** Considered. Deferred to v1.5 with ref-counting because the substrate is "store the artifact" not "store the lifecycle."
- **Hash the encrypted ciphertext instead of plaintext.** Loses dedup (per-blob salt makes every ciphertext unique) and complicates the embedding pipeline.

## References

- `apps/worker/src/services/storage.ts` — `writeFile`, the `r2.head → r2.put` path, `FileMeta` shape.
- `packages/shared/src/types.ts` — `StorageLocator.object_key` defaults to `content/<hash>`.
- `apps/worker/src/services/embeddings.ts` — content-hash idempotent embedding.
- ADR-0005 — bucket driver, which sees `content/<hash>` keys.
- ADR-0006 — envelope encryption, which sits between plaintext-hashing and storage-of-ciphertext.
