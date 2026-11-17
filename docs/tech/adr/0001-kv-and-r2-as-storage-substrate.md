# ADR-0001: KV + R2 as the storage substrate

**Status:** Accepted — 2026-05-15

## Context

AgentDrive needs to persist three classes of data: file content (variable size, write-once-read-many), structured metadata (workspaces, files, versions, comments, activity, sessions, share tokens, API key hashes), and embeddings for semantic search. The service runs on Cloudflare Workers. Every primitive is either a Cloudflare service or something we'd have to host ourselves.

The conventional choice for a backend with this shape is Postgres (or its managed analogues — Neon, Supabase, Cloudflare D1) for metadata plus an object store for blobs. That's the architecture every senior engineer expects when they open the repo.

## Decision

Use **Cloudflare KV for all metadata** and **Cloudflare R2 for all file content**. There is no relational database in the system. There is no D1. There is no Neon. Embeddings live in Cloudflare Vectorize.

KV keys are flat, prefix-namespaced strings (e.g. `file:<ws_id>:<path>`, `activity:<ws_id>:<ts>:<event_id>`). Lookups are point reads or `kv.list({ prefix })` with cursor pagination. R2 keys are content-addressed (`content/<sha256>`); the locator that points at them lives in the file's KV metadata.

The decision is documented as a hard constraint in `CLAUDE.md` under "What NOT to do": *do not add Postgres / Neon / D1*.

## Consequences

**Easier:**

- One vendor. Zero egress between metadata and storage. No managed-DB cost line.
- Globally distributed reads with no replication setup. The Worker reads metadata from the closest KV edge.
- No schema migrations. Adding a field is "write the new shape; readers handle missing fields."
- Operational surface is tiny. There is no Postgres to back up, no connection pool to tune, no failover to test.

**Harder:**

- No JOINs. Anything that would be a foreign-key traversal becomes a secondary index key. Adding a new query shape often means adding (and backfilling) a new index prefix.
- No ad-hoc analytics. You cannot `SELECT count(*) FROM files WHERE ws_id = ? AND mime_type LIKE 'image/%'`. Aggregations require either an index that was planned for or a `kv.list` scan + filter at request time.
- KV is eventually consistent. Within the same worker invocation, a write you just made may not be visible to a `list` call. Code that depends on read-your-writes must use the same key it wrote (point reads are read-your-writes).
- 25 MB per KV value cap, 512 byte key cap. Schema design has to respect both.

**Trigger to revisit:** migrate to D1 or Postgres when *either* a single workspace exceeds 100k files *or* a paying Enterprise customer needs complex relational queries that no single index can satisfy.

## Alternatives considered

- **D1 (Cloudflare's SQLite).** Still a beta-quality preview when the decision was made. Per-database row caps that would force sharding very early. Reconsidering at the trigger above.
- **Neon Postgres on Cloudflare Hyperdrive.** Adds another vendor, a connection pool, and a latency floor. The win (real SQL) didn't justify the cost at v0.
- **Cloudflare D1 + R2 split.** Same trade-off as Postgres + R2; loses the "one vendor, one billing surface" property.
- **Durable Objects per workspace.** Considered for strong-consistency workloads. Rejected because it would force every read through one DO instance per workspace, killing the sub-100ms edge-read property. DOs are reserved for the parked `FileCollab` real-time path and the optional `SANDBOX` binding.

## References

- `apps/worker/src/services/storage.ts` — every KV key shape in the system.
- `apps/worker/wrangler.toml` — the `META` (KV) and `CONTENT` (R2) bindings.
- `CLAUDE.md` — "Storage layout" section.
- ADR-0008 — content-addressed storage, the partner decision.
