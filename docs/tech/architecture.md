# AgentDrive Architecture

This document is the single canonical system overview. It answers "what runs where, what talks to what, and what does each piece do." Read this before `CONTRIBUTING.md` if you're new to the codebase; read `CONTRIBUTING.md` after when you're about to make a change.

The load-bearing decisions are documented separately as ADRs under [`docs/tech/adr/`](./adr/) — this doc links into them rather than repeating the reasoning.

---

## System diagram

```
        Agent hosts                                Distribution
        +--------------+                          +-------------------+
        | Claude Code  |                          | npm @adrive/*     |
        | Codex CLI    |  --- MCP / stdio --->    | curl install      |
        | Cursor       |                          | Smithery / Glama  |
        | Zed / Cline  |                          +-------------------+
        | Continue     |
        | LangGraph    |  --- HTTPS REST --->     +-------------------+
        +--------------+                          | apps/web          |  marketing + dashboard
                                                  | (Next.js → CF)    |  agentdrive.sh
                                                  +-------------------+
                                                          |
                                                          v
                                  +----------------------------------------------+
                                  | Cloudflare Worker (Hono)                     |
                                  |   apps/worker — app.agentdrive.sh            |
                                  |                                              |
                                  |   Routes  -> auth -> services -> bindings   |
                                  +----------------------------------------------+
                                          |               |               |
                                          v               v               v
                                  +------------+   +------------+   +-----------+
                                  | KV         |   | R2         |   | Vectorize |
                                  | KV binding |   | R2 binding |   | embeddings|
                                  | metadata   |   | sha256-keyed   | 768-dim   |
                                  +------------+   +------------+   +-----------+
                                                          |
                                                          v
                                                  +-------------------+
                                                  | BucketDriver      |  ADR-0005
                                                  | R2 default        |
                                                  | R2 cross-account  |
                                                  | S3-HMAC           |
                                                  +-------------------+
                                                          |
                                                          v
                                                  +-------------------+
                                                  | Customer bucket   |  BYO
                                                  | (any S3-compat)   |
                                                  +-------------------+

                                  +-------------------+
                                  | Workers AI        |  BGE-base-en-v1.5
                                  | Email Workers     |  magic-link
                                  | Containers (opt)  |  per-workspace sandbox
                                  | Durable Objects   |  FileCollab (parked), SANDBOX, MagicCodes
                                  +-------------------+
```

---

## Runtime

The entire backend runs on **one Cloudflare Worker** (`apps/worker`), built on **Hono** with the MCP TypeScript SDK and Zod for validation. The runtime decision is explained in [ADR-0002](./adr/0002-hono-on-cloudflare-workers.md).

Worker entry: `apps/worker/src/index.ts` mounts the per-domain route modules:

| Mount | File | Purpose |
|---|---|---|
| `/v1/workspaces/:wid/files` | `routes/files.ts` | CRUD, versions |
| `/v1/workspaces` | `routes/workspaces.ts` | Workspace lifecycle |
| `/v1/workspaces/:wid/share` | `routes/shares.ts` | HMAC share tokens |
| `/v1/workspaces/:wid/files/:fid/comments` | `routes/comments.ts` | Per-file comment threads |
| `/v1/workspaces/:wid/activity` | `routes/activity.ts` | Append-only activity feed |
| `/v1/org`, `/v1/org/timeline` | `routes/orgs.ts`, `routes/timeline.ts` | Org / member / timeline |
| `/v1/auth/*`, `/auth/oauth/*` | `routes/auth.ts`, `routes/oauth.ts` | Magic-link, OAuth |
| `/v1/search`, `/v1/context` | `routes/search.ts`, `routes/context.ts` | Semantic + rerank |
| `/v1/runs` | `routes/runs.ts` | Agent run logging |
| `/v1/bucket-config` | `routes/bucket-config.ts` | BYO-bucket CRUD + verify |
| `/v1/billing/*` | `routes/billing.ts` | Stripe portal + plan |
| `/v1/workspaces/:wid/sandbox/*` | `routes/sandbox.ts` | Experimental Containers exec |
| `/v1/register`, `/install`, `/install.sh` | `routes/register.ts`, `routes/installer.ts` | Self-onboard + script delivery |
| `/v1/auth/cli/*` | `routes/cli-auth.ts` | Browser-assisted CLI login |

Custom domain: `app.agentdrive.sh`. The current website, docs and dashboard are served by the separate `apps/web` OpenNext Worker at `agentdrive.sh`, whose `API` service binding targets this API Worker. `apps/frontend` is legacy.

CI gate: `scripts/ci.sh` runs typecheck, test, build, verify-claims, the browser regressions and a production dependency audit on each PR (GitHub's merge of its head into the base), on the maintainer's machine.

---

## Storage layout

Application metadata lives in **Cloudflare KV** under prefixed keys. Hosted MCP OAuth uses a separate `OAUTH_KV` namespace. File content goes to the selected bucket driver, defaulting to **Cloudflare R2** as `content/<sha256>`. Embeddings live in **Cloudflare Vectorize**. There is no Postgres / Neon / D1. The reasoning is in [ADR-0001](./adr/0001-kv-and-r2-as-storage-substrate.md).

### KV prefixes

| Prefix | Value shape | Notes |
|---|---|---|
| `org:<org_id>` | `OrgMeta` | Organization record |
| `ws:<ws_id>` | `WorkspaceMeta` | Workspace record |
| `idx:org_workspaces:<org_id>:<ws_id>` | workspace ID | Reverse index for listing workspaces by org |
| `org_agent:<org_id>:<agent_id>` | `OrgAgent` | Organization agent membership and revocation |
| `org_member:<org_id>:<email>` | `OrgMember` | Human org membership and owner/admin/member role |
| `file:<ws_id>:<file_id>` | `FileMeta` | Current version and storage locator |
| `idx:ws_files:<ws_id>:<path>` | file ID | Path lookup and workspace file listing |
| `ver:<file_id>:<padded_version>` | `FileVersion` | Historical version; six-digit zero-padded version |
| `comment:<file_id>:<comment_id>` | `Comment` | Comment body and author |
| `idx:file_comments:<file_id>:<inv_ts>:<comment_id>` | comment ID | Newest-first comment index |
| `activity:<ws_id>:<inv_ts>:<event_id>` | `ActivityEvent` | Time-keyed activity feed |
| `api_key:<sha256(key)>` | `ApiKeyMeta` | Key metadata looked up by hash; no full plaintext key in this record |
| `api_key_used:<sha256(key)>` | ISO timestamp | Last-used time, separate from the revocable key record |
| `token:<tid>` | `ShareTokenMeta` | Share scope, issuer, revocation and limits; legacy `use_count` |
| `token_used:<tid>` | decimal count string | Current share-token use count |
| `session:<sid>` | `SessionMeta` | Human session from email-code or provider sign-in |
| `role:<ws_id>:<email>` | `RoleAssignment` | Email-keyed workspace permission and issuer |
| `run:<org_id>:<run_id>` | `AgentRun` | Per-run record |
| `idx:agent_runs:<agent_id>:<inv_ts>:<run_id>` | run ID | Time-keyed run index |
| `idx:content_refs:<content_hash>:<ws_id>:<file_id>` | `"1"` | Live file references used for vector cleanup |
| `bucket_config:<org_id>:<config_id>` | `BucketConfigMeta`, optional `archived_at` | Active or retired bucket configuration |

Pagination is **always** cursor-based — `kv.list({ prefix, cursor, limit })`. Never hardcode `limit > 1000` (KV cap). The shared `Paginated<T>` helper lives in `packages/shared/src/types.ts`.

### R2

A single content key shape: `content/<sha256>`. Content-addressed; deduped at write time via the selected driver's `head` before `put`. Live-file references are tracked in KV for vector cleanup. File deletion removes current metadata, path and reference entries; it does not physically delete R2 blobs. The full reasoning is in [ADR-0008](./adr/0008-content-addressed-storage.md).

### Vectorize

Index name: `agentdrive-content`. 768-dim BGE embeddings, cosine metric. Vector IDs derive from org, workspace, path, content hash and chunk index (16 chunks × 1500 chars with 200-char overlap). Identical bytes at different locations remain independently retrievable; query results are validated against current KV metadata before ranking.

---

## Storage abstraction — BucketDriver

By default, every blob writes to the shared AgentDrive R2 bucket. The implemented external-bucket creation and assignment checks require the Team plan and owning-org owner/admin authority (including authorized delegated keys and the founding key of an agent-created org):

- `agentdrive-r2` — the default shared bucket.
- `cf-r2-cross-account` — a Cloudflare R2 bucket in the customer's own account.
- `s3-hmac` — any S3-compatible endpoint (AWS S3, Backblaze B2, Wasabi, MinIO).

The `BucketDriver` interface (`apps/worker/src/services/bucket-driver/types.ts`) has four operations: `head`, `put`, `get`, `delete`. Two concrete drivers ship today: `R2DefaultDriver` and `S3CompatDriver` (hand-rolled SigV4 over Web Crypto).

Creating a configuration with `POST /v1/bucket-config` does not assign it. `PUT /v1/workspaces/:wid/bucket-config` sets that workspace's destination for new writes. `resolveDriverForWrite` uses this current workspace configuration; `resolveDriverForRead` uses the file's recorded `StorageLocator`. Legacy files with no locator default to `agentdrive-r2`. Existing files and versions retain their locators and need their original bucket and credentials after a switch.

A `/v1/bucket-config/:id/verify` endpoint runs an actual write → read → compare → delete probe. On failure, the bucket flips to `degraded` and writes refuse routing there until a verify or a successful write auto-recovers it.

Management UI: `/buckets` in the dashboard (`apps/web/app/(app)/buckets/page.tsx`).

Decision rationale: [ADR-0005](./adr/0005-bucket-driver-byo-bucket.md).

---

## Encryption at rest

Standard workspace content passes directly to the selected storage driver. AgentDrive can read it to provide search and handoff context. Storage-provider encryption is a separate layer; customer bucket encryption and access policies remain the customer's responsibility.

Private Workspace encrypts the content the CLI syncs on your machine with AES-256-GCM before upload. Its key store is local software, not an OS-backed keychain. API credential changes must preserve the local data key; the hosted service cannot recover a lost local key. Direct MCP writes are not encrypted by this CLI sync setting.

`services/envelope-encryption.ts` implements the design in [ADR-0006](./adr/0006-envelope-encryption-versioned-kek.md), but ordinary storage does not call it. Its KEK settings are not proof that blobs are envelope-encrypted, and changing them cannot recover a lost client key. A future activation needs a separately verified migration and rotation procedure.

---

## Authentication & authorization

Three auth modes resolve into a single `AuthContext` discriminated union in `apps/worker/src/middleware/auth.ts`:

### 1. Agent / API key

`Authorization: Bearer agentdrive_live_<id>` (the middleware recognizes the `agentdrive_` prefix). Key issuers hash the secret with `hashApiKey` (`packages/shared/src/validation.ts`) and store its metadata at `api_key:<sha256(key)>` in KV. The full secret is returned once when minted, but the Worker receives it again in each authenticated request and hashes it for lookup. Last use is written asynchronously to the separate `api_key_used:<sha256(key)>` record; the revocable key record is not rewritten for usage tracking.

### 2. Share token

`X-Share-Token: <token>` or `?token=<token>` in the URL. A token is a base64url payload and HMAC-SHA256 signature separated by a dot, signed against `TOKEN_SIGNING_SECRET`. Its `TokenPayload` includes workspace, optional file id, permission and optional email gate, usage limit and expiry. Stored scope/revocation metadata lives at `token:<tid>`; current uses live separately at `token_used:<tid>`, with legacy `use_count` as fallback. Email-gated links also require `X-Session-Token` for the invited email. Rotation of `TOKEN_SIGNING_SECRET` invalidates outstanding share links and does not affect blob encryption.

### 3. Session

Email-code login (`/v1/auth/send-code` → `/v1/auth/verify-code`) or Google/GitHub sign-in at `/auth/oauth/*` creates a human session at `session:<sid>` in KV. Direct REST requests send that ID as `X-Session-Token: <sid>`; `flexAuth` does not authenticate a dashboard cookie directly. The website stores its session in `adrive_session` and translates it to the header. Human sign-in does not itself mint an agent API key; browser-assisted CLI login and hosted MCP OAuth mint managed agent keys through `mintAgentKey`.

`flexAuth` checks API-key bearer auth first, then share-token auth, then session auth. A request presenting both a share token and a session acts with the link's permissions; the session satisfies an optional email gate.

Permission ladder (strict total order): `view < comment < edit < owner`. Code always uses `hasPermission(actual, required)` — never string compare.

### Cross-agent identity

Every authenticated request carries two headers:

- `X-Agent-Platform` — `claude-code | codex | cursor | opencode | gemini-cli | antigravity | langgraph | crewai | autogen | hermes | openclaw | unknown` (enum in `packages/shared/src/types.ts`).
- `X-Agent-Role` — free-form, ≤64 chars.

The API key represents an agent principal in an org; the headers label which tool is calling. `ActivityEvent` and `AgentRun` record `agent_platform`. File metadata uses `created_by` / `updated_by`, versions use `actor_id` / `actor_type`, and comments use `author_id` / `author_type`; those rows do not all store a platform field. Decision: [ADR-0007](./adr/0007-cross-agent-identity-principal-plus-platform.md).

---

## Request lifecycle (write flow)

`drive_write` from Claude Code → MCP server → worker:

1. **Transport.** MCP server reads `AGENTDRIVE_API_KEY` from env, sets `Authorization` + `X-Agent-Platform: claude-code` + `X-Agent-Role`, POSTs to `/v1/workspaces/:wid/files`.
2. **Auth middleware** (`flexAuth`) parses the Bearer / Share / Session and builds the `AuthContext`. It then checks the per-principal Workers Rate Limiting binding (`apps/worker/src/middleware/rate-limit.ts`); register and magic-code routes are limited by IP.
3. **Route handler** (`routes/files.ts`) validates the body with Zod, checks `hasPermission(auth, 'edit')` against the workspace.
4. **`storage.writeFile`**:
   - Computes SHA-256 of the supplied content (including ciphertext for an encrypted CLI upload).
   - Resolves the destination driver via `resolveDriverForWrite(env, workspace, contentHash)` — usually `R2DefaultDriver`, sometimes an S3-HMAC driver for a BYO bucket.
   - Preserves the supplied content (plaintext for standard writes, ciphertext for Private Workspace content the CLI syncs).
   - `driver.head(content/<hash>)` — if present, skip the write (dedup).
   - `driver.put(content/<hash>, content)` if absent.
   - Writes `FileMeta` to KV with the `StorageLocator` recorded.
   - Writes `FileVersion` for the version history.
   - Writes an `ActivityEvent`.
   - `ctx.waitUntil(embed(content, hash))` — fire-and-forget; failures don't block the response.
5. **Response** — `FileMeta` returned (without secrets). Total latency target: <100 ms warm.

Read flow is route → `storage.readFile` → resolve driver from the stored locator → `driver.get` → return stored content. The CLI decrypts Private Workspace content locally. **Writes route by current config; reads route by the locator stored on the file**. Retired bucket credentials remain available for historical reads; actively assigned bucket configs cannot be removed until reassigned.

---

## Search and context

Three pipeline endpoints work together:

- **`POST /v1/search`** — semantic search with keyword fallback over the org's artifacts. Vectorize KNN query, tenant-isolated by `org_id`. Optional filters: workspace, agent_platform, agent_id, path_prefix. Returns `RetrievalResult[]` with a semantic score and indexed chunk snippet, or a null score for keyword fallback.
- **`POST /v1/runs`** — append-only log of agent runs (`{ task, artifacts_referenced, artifacts_produced, status, duration_ms, agent_platform, agent_role }`). Keyed `run:<org_id>:<run_id>` + indexed `idx:agent_runs:<agent_id>:<inv_ts>:<run_id>`.
- **`POST /v1/context`** — the killer endpoint. Takes a task description, returns top-N artifacts ranked by `0.7 × semantic_score + 0.3 × exp(-age_days / 30)`. Uses indexed chunk snippets, falling back to up to 500 characters from the stored file when needed. Used by `drive_context` and the auto-context preflight on agent session start.

`drive_recall` (intended for extracted facts) currently delegates to artifact search; extracted-fact narrowing is not implemented.

---

## Deployment topology

| Surface | Host | Type | Notes |
|---|---|---|---|
| API + Worker | `app.agentdrive.sh` | Cloudflare Worker | Single deploy via `pnpm --filter @agentdrive/worker run deploy` |
| Dashboard | `agentdrive.sh/*` | OpenNext Cloudflare Worker (apps/web) | Server API calls use the `API` service binding |
| Public docs | `agentdrive.sh/docs` | apps/web/content/docs | Served with the website Worker |
| Install script | `agentdrive.sh/install` | Generated string in the Worker | Built from `apps/installer/install.sh` via `apps/installer/build.mjs` |

CI and deploys run on the maintainer's machine, not GitHub Actions: `scripts/ci.sh` checks one commit and posts each job as a commit status. Deploys go out from there too, only for a commit whose statuses are green; deploy and rollback procedures live in a maintainer runbook.

Compatibility date `2025-02-20`. `nodejs_compat` flag enabled (for `Buffer`, `crypto` interop shims).

---

## Bindings

The Worker reads everything through Cloudflare bindings — no env-var URLs to remote services.

| Binding | Type | Use | Required? |
|---|---|---|---|
| `KV` | KV namespace | Application metadata | Yes |
| `OAUTH_KV` | KV namespace | Hosted MCP OAuth grants, tokens and registered clients | For hosted MCP OAuth |
| `R2` | R2 bucket (`agentdrive-content`) | Default file body storage | Yes |
| `VECTORIZE` | Vectorize index (`agentdrive-content`) | Embeddings | Yes |
| `AI` | Workers AI | `@cf/baai/bge-base-en-v1.5` for embeddings | Yes |
| `SEND_EMAIL` | Cloudflare Email Workers | Magic-link delivery | Yes |
| `FILE_COLLAB` | Durable Object (`FileCollab` class) | Real-time collab — parked, not implemented | Bound, unused |
| `MAGIC_CODES` | Durable Object (`MagicCodes` class, SQLite) | Email sign-in codes, one object per lowercased email: live code, wrong-guess lockout, send cap | Bound |
| `IDEMPOTENCY` | Durable Object (`IdempotencyRecord` class, SQLite) | REST `Idempotency-Key` claims, one object per (principal, key): the in-flight claim and the stored response, deleted by alarm after 24 hours | Bound |
| `SANDBOX` | Durable Object (Cloudflare Containers) | Per-workspace Linux sandbox | Optional — 503s when unbound |

Secrets (via `wrangler secret put`):

| Secret | Purpose |
|---|---|
| `TOKEN_SIGNING_SECRET` | HMAC key for share tokens. Rotation invalidates all share links. |
| `BUCKET_KEK_ROOT`, `BUCKET_KEK_VERSION`, `BUCKET_KEK_ROOT_PREVIOUS` | Reserved envelope-encryption design (ADR-0006), not wired into ordinary storage. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe API + webhook validation. |
| `STRIPE_PRICE_PRO`, `STRIPE_PRICE_TEAM` | Stripe price IDs for the two self-service paid plans. |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth. |
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth. |
| `MAILMOLT_API_KEY` | Optional transactional inbox provisioning at `/v1/register`. Graceful-degrades when unset. |

---

## Surfaces

Four shipped integration surfaces, plus the dashboard:

| Surface | Package | Description |
|---|---|---|
| MCP server | `@adrive/mcp-server` | 22 tools over stdio (18 stable + 4 experimental sandbox). Primary integration. |
| CLI | `@adrive/cli` (`adrive`) | Commands include `init`, `push`, `pull`, `search`, `context`, `transcripts`, `watch`, `privacy`. |
| TypeScript SDK | `@adrive/sdk` | Constructor-based client; same shape as the MCP server's ApiClient. |
| REST API | `app.agentdrive.sh/v1/*` | Universal fallback; everything not MCP uses HTTP+JSON. |
| Dashboard | `apps/web` at `agentdrive.sh` | Next.js; routes: `/dashboard`, `/files`, `/runs`, `/memory`, `/shares`, `/agents`, `/keys`, `/buckets`, `/billing`, `/team`, `/settings`, `/onboarding`. |

The decision to lead with MCP is in [ADR-0003](./adr/0003-mcp-first-integration-surface.md).

---

## What's parked / experimental

These are intentionally not v1 goals — naming them here prevents future contributors from "fixing" them by accident:

- **Real-time collab CRDT (`FileCollab` Durable Object).** Bound but unimplemented. Multi-agent simultaneous editing of the same file is not v1.
- **Per-workspace Linux sandbox (`drive_sandbox_*` tools).** Experimental — requires the Cloudflare Containers plan. Returns 503 cleanly when `SANDBOX` is unbound. Tools are flagged `[EXPERIMENTAL]` in their MCP descriptions.
- **WYSIWYG editor.** Agents don't need one.
- **Postgres / Neon / D1 migration.** KV holds; trigger documented in [ADR-0001](./adr/0001-kv-and-r2-as-storage-substrate.md).

---

## What to read next

- Style and contribution rules: `CONTRIBUTING.md`.
- Public docs (user-facing): `apps/web/content/docs/` (served at agentdrive.sh/docs).
- All the load-bearing decisions in one place: [`docs/tech/adr/`](./adr/).

---
**Owner:** Rakesh Roushan · **Last reviewed:** 2026-06-21 · **Review by:** 2026-09-21
