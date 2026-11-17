# ADR-0005: BucketDriver indirection for BYO-bucket

**Status:** Accepted — 2026-05-19

## Context

Phase 4 of the v1 roadmap required customers to be able to route their workspace's file content to their own bucket — Cloudflare R2 in a different account, AWS S3, Backblaze B2, MinIO, anything S3-compat. This opens the Team and Enterprise tiers, where data-residency or egress-control is a buying criterion.

The naïve implementation would inline an S3 client in `storage.ts` and branch on provider per call site. That couples every read/write path to every supported provider, makes new providers a sweeping diff, and forces the worker to know the credential format of every S3-compat dialect.

## Decision

Introduce a `BucketDriver` interface (`apps/worker/src/services/bucket-driver/types.ts`) with three operations: `put`, `get`, `delete`. Ship three implementations:

- `R2DefaultDriver` — wraps the bound R2 namespace (`env.R2`). Used by every org that hasn't configured a BYO bucket.
- `S3CompatDriver` — speaks the S3 REST API using SigV4 (HMAC-signed requests via Web Crypto). Used for both `cf-r2-cross-account` and generic `s3-hmac` providers; the difference is purely in the endpoint and region.
- (Future) `GCSDriver`, `AzureBlobDriver`.

A `BucketConfigStore` (`apps/worker/src/services/bucket-config.ts`) persists per-org bucket configs in KV under `bucket_config:<org_id>:<id>`. Each `FileMeta` and `FileVersion` carries a `StorageLocator` that names the `bucket_config_id`, `provider`, `object_key`, and `key_version`. Legacy rows with no locator are treated as the implicit `default` config pointing at AgentDrive's shared R2.

`resolveDriverForRead` and `resolveDriverForWrite` (`apps/worker/src/services/bucket-driver/resolve.ts`) are the only paths that build a concrete driver. `storage.ts` never sees a provider.

A `/v1/bucket-config/:id/verify` endpoint runs an actual write→read→compare→delete probe against the configured bucket; on failure, the config flips to `degraded` and writes refuse until a successful verify or a successful write auto-recovers it.

## Consequences

**Easier:**

- New providers cost ~150 LOC and a test file; no other change to the worker.
- Reads honor the stored locator forever. Switching a workspace's bucket *prospectively* doesn't migrate the past — old files keep working through the old driver.
- Verify + auto-degrade gives the customer a recovery loop that doesn't require us in the chain.
- BYO-bucket on Team opens a $149/mo tier that was previously stuck on data-residency objections.

**Harder:**

- Per-blob writes can fail with provider-specific errors (S3's eventual consistency, R2's per-account rate limits). Error handling is genericized at the driver boundary; loss of specificity is the cost.
- Encryption-at-rest (ADR-0006) lives *above* the driver. The driver sees ciphertext + key id, never plaintext. This is intentional — a customer-controlled bucket should not have a path to derive worker secrets, and the worker should not need to trust the bucket's at-rest crypto.

## Alternatives considered

- **One bucket per customer, enforced at the AgentDrive R2 layer.** Doesn't satisfy data-residency. Customer cloud cost falls on us.
- **Branch on provider inside `storage.ts`.** Rejected — couples storage shape to every provider; the test matrix grows multiplicatively.
- **Use a library (`@aws-sdk/client-s3`).** The official SDK is ~1 MB minified and ships in a Node shape that doesn't tree-shake well in Workers. Hand-rolled SigV4 in 200 LOC is small enough to own.
- **One global "use this bucket" toggle per org.** Loses per-workspace flexibility, which Team customers want (one workspace per project, each in its compliance-correct region).

## References

- `apps/worker/src/services/bucket-driver/types.ts` — driver interface.
- `apps/worker/src/services/bucket-driver/r2-default.ts`, `s3-compat.ts`, `resolve.ts` — concrete implementations.
- `apps/worker/src/services/bucket-config.ts` — config store.
- `apps/worker/src/routes/bucket-config.ts` — REST API.
- `apps/web/app/(app)/buckets/page.tsx` — management UI.
- ADR-0006 — envelope encryption sitting above the driver.
- ADR-0008 — content addressing, which keeps blob keys stable across drivers.
