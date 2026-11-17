# Repo guide for contributors and AI coding agents

This file is the orientation document for anyone working *inside* this repository — new contributors, interns, and AI coding agents (Claude Code, Codex, Cursor, etc.). It documents the non-obvious context: what to do, what NOT to do, and where the bodies are buried. Read it once before your first PR; refer back when something surprises you.

## What this project is

AgentDrive is the cross-agent artifact workspace with provenance and portable storage for multi-agent workflows. See `README.md` for the user-facing pitch. The product used to be framed as "Google Drive for agents + humans" and was repositioned in May 2026 around cross-platform artifacts + provenance; the substrate is unchanged, the framing is.

Licensing: `apps/worker`, `apps/web` and `apps/frontend` are `AGPL-3.0-only`; the client packages (`packages/*`, `apps/installer`, `apps/docs`, the Claude Code plugin) are `Apache-2.0`. A new file inherits the license of the package it lands in, so put code in the right package. External contributions need a signed CLA (`CLA.md`). See `LICENSING.md` and [ADR-0009](./docs/tech/adr/0009-agpl-server-license.md).

## Working directory + repo layout

Turbo monorepo. pnpm workspaces. Node 20, pnpm `10.13.1` pinned via `packageManager`.

```
apps/
  worker/      Cloudflare Worker (Hono) — the entire backend API
  frontend/    React 19 + Vite 7 SPA dashboard (served as Worker asset binding)
  web/         Next.js marketing + app shell
  docs/        Astro Starlight public docs site (docs.agentdrive.sh)
  installer/   Shell installer + generated artifact script
packages/
  mcp-server/  Stdio MCP server, the primary integration surface
  cli/         `adrive` CLI (transcripts, watch, privacy, init)
  sdk-ts/      TypeScript SDK
  shared/      Types, ids, HMAC token sign/verify, Zod schemas
docs/
  strategy/    Internal strategy + ops docs — not user-facing
  launch/      Launch-week drafts (Show HN, twitter thread, CF AI app)
```

Top-level scripts:
- `pnpm dev:worker` — local Worker (wrangler dev)
- `pnpm dev:frontend` — local Vite dev server
- `pnpm dev:docs` — local Astro dev server
- `pnpm build` — turbo build across all workspaces
- `pnpm typecheck` — turbo typecheck across all workspaces
- `pnpm test` — vitest across the worker and packages

## Storage layout (non-obvious — reverse-engineered from `apps/worker/src/services/storage.ts`)

The single canonical system overview lives at [`docs/tech/architecture.md`](./docs/tech/architecture.md). The reasoning behind each load-bearing choice is captured as an ADR under [`docs/tech/adr/`](./docs/tech/adr/). The section below is the operational summary you need before changing storage code.

There is NO Postgres / Neon / D1. All metadata lives in Cloudflare KV; all file content lives in Cloudflare R2. See [ADR-0001](./docs/tech/adr/0001-kv-and-r2-as-storage-substrate.md) for why.

### R2 paths

- `content/<sha256>` — file content, content-addressed. Dedup via `r2.head` before put. Immutable per hash. The `FileMeta.content_hash` field points here.

### KV key prefixes

| Prefix | Shape | Purpose |
|---|---|---|
| `org:<org_id>` | `OrgMeta` | Organization record |
| `ws:<ws_id>` | `WorkspaceMeta` | Workspace record |
| `idx:org_workspaces:<org_id>:<ws_id>` | empty value | Reverse index for listing workspaces in an org |
| `ws_agent:<ws_id>:<agent_id>` | `{ role: Permission }` | Workspace membership + role assignment |
| `file:<ws_id>:<path>` | `FileMeta` | File metadata (current version) |
| `file_ver:<ws_id>:<path>:<n>` | `FileVersion` | Historical version record |
| `comment:<ws_id>:<path>:<comment_id>` | `Comment` | Comment thread per file |
| `activity:<ws_id>:<ts>:<event_id>` | `ActivityEvent` | Append-only activity feed, time-keyed |
| `api_key:<sha256(key)>` | `ApiKeyMeta` | API key lookup (key never stored in clear); now also carries `key_id`, `name`, `prefix` for managed keys |
| `idx:org_keys:<org_id>:<key_id>` | `sha256(key)` | Reverse index for listing/revoking an org's keys via `/v1/keys` (value is the hash, never the secret) |
| `token:<tid>` | `{ revoked, uses_count, max_uses, ... }` | HMAC share token revocation + usage tracking |
| `session:<sid>` | session record | Magic-link human session |
| `role:<ws_id>:<agent_id>` | `Permission` | Per-workspace role for an agent (alt path to `ws_agent:`) |
| `activation:<org_id>` | `{ at, from, to, agent_id, project }` | The org's first cross-harness session resume (written once, from the file content read route) |
| `metric:xresume:<iso_week>:<org_id>:<agent_id>` | empty value, metadata `{ from, to, at }`, TTL 400 days | One per API-key principal per ISO week (e.g. `2026-W46`) that resumed a session from another harness; read by `apps/worker/scripts/weekly-metrics.ts` |
| `xresume_m:<org_id>:<YYYY-MM>:<hash>` | empty value, TTL 40 days | Resume meter: one per (session path, reading harness) per UTC month, `hash` = first 32 hex of `sha256(path + "\|" + harness)`. The org's monthly cross-agent resume count is the key count under `xresume_m:<org_id>:<YYYY-MM>:` (Free limit 10; refused only when `RESUME_METER_ENFORCE = "true"`) |

Verify prefixes by reading `apps/worker/src/services/storage.ts` before changing any key shape. The list above is the audit snapshot — code is authoritative.

### Pagination

`kv.list` is the only way to enumerate KV. **Use cursor-based pagination**. See `Paginated<T>` in `packages/shared/src/types.ts`. Default page size 50. Never hardcode `limit` higher than 1000 (KV cap).

## Auth model

Three modes resolve into one `AuthContext` (`apps/worker/src/middleware/auth.ts`):

1. **Agent / API key** — `Authorization: Bearer agentdrive_live_<id>`. Hashed (`hashApiKey`) and looked up at `api_key:<hash>`. `last_used_at` updated via `waitUntil` for non-blocking writes.
2. **Share token** — `X-Share-Token` or `?token=`. HMAC-SHA256 signed `TokenPayload` (v1 prefix). Verified against `TOKEN_SIGNING_SECRET`. Revocation + max-use enforced via `token:<tid>` lookup. Email-gated optionally.
3. **Session** — magic-code email login. Session lives in `session:<sid>`.

Permission ladder (strict total order): `view < comment < edit < owner`. Use `hasPermission(actual, required)` — never compare strings directly.

### Cross-agent identity

One API key represents a *principal* (human or team). Per-session headers `X-Agent-Platform` and `X-Agent-Role` distinguish "Claude Code on Tuesday" from "Codex on Wednesday" in provenance records. See [ADR-0007](./docs/tech/adr/0007-cross-agent-identity-principal-plus-platform.md) for the decision rationale.

## Cloudflare bindings (`apps/worker/wrangler.toml`)

| Binding | Type | Use |
|---|---|---|
| `CONTENT` | R2 bucket (`agentdrive-content`) | File body storage at `content/<sha256>` |
| `META` | KV namespace | All metadata. Production namespace id lives in `wrangler.toml`; create your own for dev with `wrangler kv namespace create META`. |
| `FILE_COLLAB` | Durable Object (`FileCollab` class) | Parked. Real-time collab CRDT not implemented and NOT a v1 goal. Do not invest here. |
| `MAGIC_CODES` | Durable Object (`MagicCodes` class, SQLite) | One per lowercased email (`idFromName`): the live sign-in code, wrong-guess count, 15-minute lockout after 5 and the 5-an-hour send cap. Magic codes are not in KV. |
| `VECTORIZE` | Vectorize index | Embeddings storage |
| `AI` | Workers AI binding | `@cf/baai/bge-base-en-v1.5` for embeddings |
| `SANDBOX` | Durable Object (optional) | Per-workspace Linux sandbox. 503s when unbound. |
| `RL_PRINCIPAL` | Rate limit (100 / 10 s) | Per principal (agent key, share link, session), checked once in `flexAuth` |
| `RL_SEARCH` | Rate limit (20 / 10 s) | Per principal on `/v1/search` and `/v1/context` |
| `RL_REGISTER`, `RL_MAGIC` | Rate limit (5 / 60 s, 10 / 60 s) | Per IP on register and magic-code routes. All limiters fail open; limits live in `[[ratelimits]]` and are mirrored in `vitest.config.ts` |
| `OAUTH_KV` | KV namespace (`agentdrive-worker-OAUTH_KV`) | Hosted-MCP OAuth clients, grants and tokens, owned by `@cloudflare/workers-oauth-provider` (the library requires this binding name). See `apps/worker/src/routes/oauth-server.ts`. |
| `MCP_URL` | var | Canonical hosted MCP resource (`https://mcp.agentdrive.sh/mcp`). `SITE_URL` is the OAuth issuer. |

Secrets (set via `wrangler secret put` — never commit):
- `TOKEN_SIGNING_SECRET` — HMAC key for share tokens. Rotation = invalidate all outstanding share links.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — Stripe API
- `BUCKET_KEK_ROOT`, `BUCKET_KEK_VERSION`, `BUCKET_KEK_ROOT_PREVIOUS` — envelope-encryption keys (see `apps/worker/src/env.ts` for rotation procedure)
- `MAILMOLT_API_KEY` — optional integration for transactional inbox provisioning at `/v1/register`. Graceful-degrades when unset.

Magic-code email delivery (`EmailService.sendMagicCode`) sends via the **Cloudflare Email Sending** `SEND_EMAIL` binding (`[[send_email]]` in `wrangler.toml`) using the structured `send({ from, to, subject, html, text })` API — no API key. Email Sending (distinct from Email Routing's forward-only binding) delivers to **arbitrary recipients** once the sender domain is onboarded: `wrangler email sending enable agentdrive.sh`. If the binding is unbound, `sendMagicCode` returns `false` in production (so `/v1/auth/send-code` returns 502 instead of a false "code sent") and logs the code locally in dev/test. A send error surfaces the Cloudflare `E_*` code (e.g. `E_SENDER_NOT_VERIFIED` = domain not onboarded).

Compatibility date `2025-02-20`. `nodejs_compat` and `global_fetch_strictly_public` flags enabled (the latter is required for OAuth Client ID Metadata Document fetches).

## Deploy

```bash
pnpm --filter @agentdrive/worker run deploy   # publishes apps/worker
```

Custom domain `app.agentdrive.sh` — the worker also serves the frontend bundle via the `[assets]` binding pointing at `../frontend/dist`.

CI: `.github/workflows/ci.yml` runs `typecheck` + `test` on PR. Do not bypass: every change reaches `main` through a PR whose CI passed. Never push to `main` directly in this repo, even where a global config pre-authorizes `git push origin main`.

## Style rules (non-negotiable)

These are the house conventions. Apply them to every edit:

1. **TypeScript-first.** No JavaScript files. No `any` unless unavoidable and commented why.
2. **pnpm only.** Never `npm install` or `yarn add` in the monorepo. Use `pnpm add` / `pnpm --filter <pkg> add`.
3. **Hono for routing, Zod for validation, MCP SDK for tools.** Don't introduce Express/Fastify/io-ts/etc.
4. **No emojis** in code, comments, commit messages, or any file we ship.
5. **No "what" comments.** Code names should explain what. Comments only when the WHY is non-obvious (a hidden constraint, a workaround, a subtle invariant).
6. **No backwards-compat shims** unless explicitly authorized. Delete unused code; don't deprecate-in-place.
7. **No half-finished stubs.** If you start something, finish it or revert it.
8. **No `--no-verify` on git commits.** Fix the hook failure root cause.
9. **No AI co-authorship attribution** in commits, comments, or any artifact. No `Co-Authored-By: Claude` / `Anthropic` / model-vendor lines.
10. **Never create new markdown docs, planning docs, or README files unless explicitly requested.** Work from conversation context.

## Testing

Vitest + `@cloudflare/vitest-pool-workers`. Tests live under `apps/worker/test/`. Run:

```bash
pnpm --filter @agentdrive/worker test
pnpm test                                  # turbo across all workspaces
```

Highest-priority test surfaces:
- `signToken` / `verifyToken` round-trip + tamper detection
- `hashApiKey` determinism + format
- Permission ladder (`hasPermission`)
- Share-token revocation + `max_uses` enforcement
- `/v1/register` happy path + transactional-email graceful degradation

## What NOT to do

- **Do not add Postgres / Neon / D1.** Single-region KV is the intentional choice. If you think you need a relational query, restructure the KV keys first.
- **Do not implement OT/CRDT real-time collab.** The `FileCollab` Durable Object is parked. Multi-agent simultaneous editing of the same file is not a v1 goal.
- **Do not add a WYSIWYG editor.** Agents don't need one.
- **Do not enforce Stripe quotas until 10 paying users.** The scaffolding is there but premature enforcement creates support load with zero revenue upside.
- **Do not change KV key shapes** without updating `storage.ts` AND backfilling existing keys. KV has no schema migration tool.
- **Do not commit any of the secrets above.** They live in the Cloudflare dashboard. `.dev.vars` is gitignored.

## Cross-product integration boundaries

- **Transactional-email signup hook** is wired at `/v1/register`. `EmailService.registerMailmoltAgent` provisions a downstream inbox + claim URL on signup. The integration is feature-flagged off the presence of `MAILMOLT_API_KEY` and graceful-degrades. Don't break this contract — extend it instead.
- **External token introspection** is planned as the replacement for the homegrown `hashApiKey` lookup. Touch `auth.ts` carefully — that's the migration boundary.
- **Bounty payouts** (external partner, future) settle against AgentDrive share URLs. The `drive_share` shape is part of that contract.

## Open issues (audit-flagged, in flight or planned)

- KV silent truncation at `limit: 100` — fixed; replaced with cursor pagination.
- Route-split refactor of `apps/worker/src/index.ts` — landed; routes now live under `apps/worker/src/routes/`.
- Sandbox MCP tools (`drive_sandbox_*`) are experimental and require the Cloudflare Containers plan. They 503 cleanly when unbound.

## Strategy + ops references

Strategy, go-to-market, audit and metrics docs (`docs/strategy/`, `docs/gtm/`, `docs/audits/`, `docs/ops/metrics.md`, `launch-assets/`) are internal. They live only in the private repo and are not part of the public repo, so nothing public (code, tests, docs, README) may link to or depend on them.

Public references:

- `docs/product/roadmap.md` — v1 plan and what shipped
- `docs/ops/runbook.md` — deploy / rollback / on-call / secret rotation
- `docs/tech/` — architecture and ADRs
- `LICENSING.md`, `CLA.md`, `TRADEMARKS.md`, `CONTRIBUTING.md`

## Onboarding checklist for new contributors

1. `pnpm install` from the repo root.
2. Copy `.dev.vars.example` (if present) to `apps/worker/.dev.vars` and ask the project owner for non-secret local values.
3. `pnpm typecheck` and `pnpm test` should both pass on a clean clone — if they don't, that's the first bug to file.
4. `pnpm dev:worker` boots the API at `http://localhost:8787`; `pnpm dev:frontend` boots the SPA.
5. Pick an issue tagged `good-first-issue` or `help-wanted`. When in doubt, ask before refactoring — small diffs over large rewrites is the house preference.
