# ROADMAP — v1 Sprint (4–6 weeks)

**Start:** 2026-05-16 (the day after pivot lock)
**Target v1 launch:** broad launch is gated; run controlled dogfood/private beta first
**Last refreshed:** 2026-05-24 (public v1 launch marked NO-GO until beta gates are green)
**Mode:** focused sprint. AgentDrive is a top-3 active bet for this window; other portfolio projects are deprioritized.

**Status as of 2026-05-24:** Weeks 1–4 shipped (hygiene + Vectorize + endpoints + MCP v0.4.0 + TS SDK), Phase 4 (multi-cloud bucket routing) and Phase 5 (per-workspace Linux sandbox) also shipped 2026-05-19, bucket-health auto-degrade landed 2026-05-22, packages tagged v1.0.0 in commit 505b55f. Public launch is **NO-GO** until private-beta activation gates are green and public surfaces are consistent.

See [PIVOT](./PIVOT.md) for the strategic context, [POSITIONING](./POSITIONING.md) for the copy that ships with each milestone, [GTM](./GTM.md) for launch sequencing, and [KILL-CRITERIA](./KILL-CRITERIA.md) for the 90-day post-launch gate.

---

## Sprint shape

Six build weeks, then a beta gate. Each week ends with a shippable artifact. No half-finished features. If a week is at risk, cut scope inside the week — do not push into the next week.

| Week | Theme | Key shippable |
|---|---|---|
| 1 | Hygiene + Wave 1 cleanup | LICENSE + LICENSING.md + README + CLAUDE.md + auth tests + CI + KV pagination |
| 2 | Vectorize + Workers AI | Embeddings on write, `services/embeddings.ts`, Vectorize binding live |
| 3 | New endpoints + identity | `/v1/search`, `/v1/runs`, `/v1/context`; cross-agent identity model; route split refactor |
| 4 | MCP v0.3.0 → bumped to v0.4.0 + TS SDK | 4 new MCP tools (memory/runs) + 4 sandbox tools (experimental) at v0.4.0, `@adrive/sdk` on npm |
| 5 | CLI + install + skill file | `drive` binary, `curl agentdrive.sh/install \| sh`, Claude Code skill file |
| 6 | Marketing + docs + beta ship | Docs rewrite, Conductor companion mode, marketplace listings, private-beta launch gate |

Plus Wave 3 (MCP marketplace listings + Anthropic skill submission + Cloudflare Workers gallery submission), Wave 4 (BYO-bucket onboarding flow + sandbox docs + first 3 enterprise discovery calls), and a v1.5 window after public launch for Python SDK, auto-extracted facts, SOC2 planning, and GCS / Azure bucket providers.

---

## Week 1 — Hygiene + Wave 1 cleanup — SHIPPED 2026-05-16

Status: complete. Landed on branch `agent-memory-layer-thesis`. All six DoD items below are met.

The initial audit flagged three blockers gating any external adoption. Fix them all in Week 1 before anything else lands.

**Definition of done:**

1. **LICENSE files in place.** Apache-2.0 for `packages/mcp-server`, `packages/cli` (will be created in Week 5 but placeholder LICENSE goes in now), `packages/sdk-ts`, `packages/sdk-py`, `packages/shared`. AGPL-3.0 for `apps/worker`, `apps/web` and `apps/frontend` (originally BSL with a 3-year Apache conversion; replaced per [ADR-0009](../tech/adr/0009-agpl-server-license.md)). Top-level `LICENSING.md` explains the split. 30 minutes.
2. **Root README.md.** What AgentDrive is, the one-liner from [POSITIONING](./POSITIONING.md), the four surfaces (MCP, CLI, SDK, skill), and a quick-start. 2 hours.
3. **CLAUDE.md at repo root.** KV key layout, R2 path scheme, auth model summary, where to add new endpoints. 1 hour.
4. **Vitest + Miniflare test harness.** Cover the auth-critical paths: `signToken` / `verifyToken`, `hashApiKey`, permission ladder, share revocation, magic-code expiry, `/v1/register` happy path. Target: >70% coverage on `apps/worker/src/middleware/auth.ts` and `packages/shared/src/token.ts`. 1 day.
5. **GitHub Actions CI.** `.github/workflows/ci.yml` runs `pnpm typecheck && pnpm test` on every PR and on push to `main`. 1 hour.
6. **KV pagination.** Replace all `kv.list({limit:100})` instances (6+ occurrences across `services/storage.ts` and elsewhere) with cursor-based pagination. Expose `cursor` in API responses. 4 hours.

Wave 1 cleanup happens here. Wave 2 work (the new product surface) starts Week 2.

---

## Week 2 — Vectorize + Workers AI bindings, embeddings on write — SHIPPED 2026-05-16

Status: complete. `services/embeddings.ts` lives, `writeFile` is hooked via `ctx.waitUntil`, Vectorize + Workers AI bindings are in `wrangler.toml`. `FileMeta` did NOT need an embedding_status field (the hook is fire-and-forget with graceful degradation — write integrity over search integrity). The backfill script was deferred — embedding-on-write covers new artifacts; an ad-hoc backfill can be one-shotted via `wrangler tail` + a custom endpoint if needed. Multi-chunk indexing shipped: 16 chunks × 1500 chars with 200-char overlap, dedupe by content_hash on retrieval.

**Manual step required before deploy:** `wrangler vectorize create agentdrive-content --dimensions=768 --metric=cosine`. Workers AI must be enabled on the account.

The semantic search and recall product depends on embeddings landing on write. This week wires that.

**Definition of done:**

1. **Wrangler config updated.** Add Vectorize binding (`VECTORIZE_INDEX` or similar) and Workers AI binding (`AI`) to `apps/worker/wrangler.toml`.
2. **New file `apps/worker/src/services/embeddings.ts`.** Wraps `@cf/baai/bge-base-en-v1.5` via Workers AI. Exposes `embed(text: string): Promise<Float32Array>` and `upsert(id, vector, metadata)` against the Vectorize binding. Falls back to `text-embedding-3-small` via AI Gateway if Workers AI rate-limits.
3. **`writeFile` in `apps/worker/src/services/storage.ts` gains an embedding hook.** On every write that produces a new content_hash, enqueue embedding via `ctx.waitUntil`. Idempotent because content-addressed.
4. **Metadata schema extension.** `FileMeta` gains `embedding_status: 'pending' | 'ready' | 'failed'` and `embedding_id: string` (Vectorize id = content_hash).
5. **Backfill script.** `apps/worker/scripts/backfill-embeddings.ts` walks existing R2 keys and enqueues embedding for any without `embedding_status === 'ready'`. Idempotent.
6. **Unit tests** for `embeddings.ts` (mocked Workers AI + Vectorize bindings via Miniflare).

**Margin check:** updated 2026-05-24 to ~$0.067 per 1M input tokens for BGE via Workers AI. Embedding current beta corpora should still be cheap in absolute dollars, but Team/Business quotas require beta usage data before enforcement.

---

## Week 3 — New endpoints + cross-agent identity + route split — PARTIALLY SHIPPED 2026-05-16

Status: endpoints + identity model shipped. Route split refactor of the 916-LOC `index.ts` deferred to a follow-up commit — new routes are mounted from `apps/worker/src/routes/{search,runs,context}.ts`, but the old handlers still live inline. Splitting them is mechanical and gates nothing.

The substrate from Week 2 gets exposed via three new endpoints and a refactored auth model.

**Definition of done:**

1. **Split `apps/worker/src/index.ts` (916 LOC) into `routes/` modules.** The empty `routes/` directory is already present — finish the refactor. Group by domain: `routes/files.ts`, `routes/workspaces.ts`, `routes/shares.ts`, `routes/comments.ts`, `routes/activity.ts`, `routes/orgs.ts`, `routes/auth.ts`, `routes/search.ts` (new), `routes/runs.ts` (new), `routes/context.ts` (new). `index.ts` becomes the wiring file only.
2. **`GET /v1/search?q=...&workspace=...`.** Returns artifacts with relevance scores and provenance. Backed by Vectorize. Zod-validated query. Pagination via cursor.
3. **`POST /v1/runs`.** Captures `{agent_platform, agent_id, run_id, task, artifacts_referenced[], artifacts_produced[], duration_ms, status}`. Stored in KV with key `run:<workspace>:<run_id>`. Queryable by `agent_id`, `workspace`, time range.
4. **`POST /v1/context`.** Takes `{task: string, limit: number}`. Returns the top-N most relevant artifacts across all sessions in the workspace, ranked semantically with a recency boost. This is the engine for the `drive_context` MCP tool in Week 4.
5. **Cross-agent identity model.** `apps/worker/src/middleware/auth.ts` extended: API key resolves to `principal_id` (not `agent_id`). Each request reads `X-Agent-Platform` and `X-Agent-Role` headers (e.g. `claude-code`, `codex`, `cursor`, `langgraph`) and writes them into `AuthContext`. Provenance fields on `FileMeta` and `AgentRun` records reference both `principal_id` and the per-request `agent_platform`.
6. **New types in `packages/shared/src/types.ts`.** `AgentRun`, `Fact` (placeholder for v1.5), `RetrievalResult`, extended `AuthContext`.
7. **Tests:** identity headers populate provenance correctly; search returns ranked results; runs round-trip.

---

## Week 4 — MCP server v0.3.0 + TypeScript SDK skeleton — SHIPPED 2026-05-19

Status: MCP server bumped to v0.4.0 (now 20 tools — 16 from v0.3.0 plus 4 sandbox tools: `drive_sandbox_clone`, `drive_sandbox_exec`, `drive_sandbox_read`, `drive_sandbox_commit`). Cursor-loop on list endpoints, identity headers stamped on every request, README published, vitest harness with 9 tests. TypeScript SDK (`@adrive/sdk@0.1.0`) shipped 2026-05-19 with 13 passing tests, full tool surface (files, search, context, runs, sandbox, roles, org, sharing, comments, activity), and drop-in compatibility with the MCP server's ApiClient shape.

The new endpoints become tools. The TS SDK lands as the third surface.

**Definition of done:**

1. **`packages/mcp-server` v0.3.0.** Four new tools registered in `packages/mcp-server/src/index.ts`:
   - `drive_search(query, workspace, limit)` — wraps `GET /v1/search`
   - `drive_recall(query, workspace, limit)` — wraps a subset of search filtered to extracted facts (facts namespace lands as v1.5; for v1, `drive_recall` aliases to `drive_search` with a `kind=fact` filter that returns empty)
   - `drive_context(task, workspace, limit)` — wraps `POST /v1/context`
   - `drive_log_run(...)` — wraps `POST /v1/runs`
2. **MCP server sends `X-Agent-Platform` and `X-Agent-Role` headers.** Defaults: platform = "mcp", role = "agent". Overridable via env (`AGENTDRIVE_AGENT_PLATFORM`).
3. **`packages/sdk-ts` published.** Skeleton: `import { AgentDrive } from '@adrive/sdk'`. Methods: `client.write()`, `client.read()`, `client.search()`, `client.context()`, `client.logRun()`. Same headers as MCP server. Published to npm as `@adrive/sdk@0.1.0`.
4. **npm publish flow documented.** GitHub Actions workflow `.github/workflows/release.yml` publishes on tag. Manual trigger for v1.
5. **End-to-end test:** an SDK call writes a file → embedding is generated → an MCP `drive_search` query from a different "agent" returns it with full provenance.

---

## Week 5 — CLI + one-line install + Claude Code skill file

The fourth surface — and the surface that makes adoption a single command.

**Definition of done:**

1. **`packages/cli` published as `@adrive/cli` (binary name: `drive`).** Commands:
   - `drive init` — provisions API key (calls `/v1/register`), writes config to `~/.config/agentdrive/config.json`
   - `drive whoami` — prints principal info
   - `drive push <file>` — wraps `drive_write`
   - `drive pull <path>` — wraps `drive_read`
   - `drive search <query>` — wraps `drive_search`
   - `drive context <task>` — wraps `drive_context`
   - `drive log-run` (used by automation; rarely typed)
2. **Install script at `agentdrive.sh/install`.** `curl -fsSL agentdrive.sh/install | sh` does:
   - Installs `drive` CLI (download from npm or GitHub releases)
   - Calls `drive init` interactively (prompts for email, magic-code login)
   - Detects installed agent tools (Claude Code, Codex CLI, Cursor) and writes their MCP config entries
   - Prints next steps
3. **Claude Code skill file** at `~/.claude/skills/agentdrive/SKILL.md` describing what AgentDrive is and how to call the CLI. Installed by the install script. Triggers on phrases like "share this with my other agent" or "what did Codex write?"
4. **Homebrew formula** drafted (`brew install agentdrive`). Ship optionally; npm + curl-pipe-bash is sufficient for v1.
5. **Manual install paths documented** for users who don't trust curl-pipe-bash.

---

## Week 6 — Marketing + docs site + Conductor mode + beta gate

The build is done. This week is distribution readiness and private-beta evidence, not broad public launch.

**Definition of done:**

1. **Docs site rewrite.** `apps/docs` (Astro Starlight) repositioned around the new framing. Quickstart, MCP tool reference, CLI reference, SDK reference, recipes ("how to share artifacts between Claude Code and Codex"), architecture page. **This is owned by Wave 2 agent H — coordinate on shared scope but do not touch `apps/docs` from this Wave 1 plan.**
2. **Conductor companion mode.** A short tutorial + skill file showing how AgentDrive plugs into Conductor's parallel-worktree workflow. Conductor team gets a heads-up.
3. **MCP marketplace listings live.** Smithery, Glama, MCP.so. Each with the [POSITIONING](./POSITIONING.md) blurb verbatim.
4. **Integration directories submitted.** Cursor MCP directory, Cline, Continue, Zed.
5. **Show HN post drafted, reviewed, but not queued.** Queue only after the public-launch gate in [GTM](./GTM.md) is green.
6. **Twitter / X thread drafted.** "How I run 5 agents in parallel without losing my mind" — built around the AgentDrive workflow.
7. **Cloudflare AI Startup program application submitted.**
8. **Anthropic Builders / OpenAI Devday applications submitted.**

End of Week 6 = **private beta live**. Public v1 launch happens only after: 10+ dogfood installs, 5+ real cross-agent workspaces, 3+ returning principals, 1+ paid Team-intent conversation, and consistent pricing/positioning across site/docs/npm/marketplaces/launch drafts.

---

## Wave 3 — MCP marketplaces + skill submission + program listings (Week 6, parallel with launch)

Promoted from prior Wave 1 placement: marketplaces are now the wedge distribution per [GTM](./GTM.md).

1. **MCP marketplace listings** — Smithery, Glama, mcp.so, PulseMCP. Submit with [POSITIONING](./POSITIONING.md) blurb verbatim, full 20-tool list (16 stable + 4 experimental sandbox), security-audited badge per "verified MCP" angle.
2. **Anthropic Claude Code skill submission** — `~/.claude/skills/agentdrive/SKILL.md` via Anthropic's skill marketplace when surface opens; otherwise via gstack-style skill ecosystem distribution.
3. **Cloudflare Workers Gallery submission** — despite Cloudflare Agent Memory being a competitive shadow, the Workers Gallery placement is still high-leverage for distribution + credit.
4. **Cursor / Cline / Continue / Zed integration directory submissions.**

## Wave 4 — BYO-bucket onboarding + sandbox docs + enterprise discovery (T+7 → T+30)

1. **`BucketConfigPage`** in frontend — see [UX.md](./UX.md) for build spec. Unlocks Team conversions stuck on data residency.
2. **BYO-bucket onboarding runbook** in [RUNBOOK.md](./RUNBOOK.md) — credential verification, bucket-health auto-degrade, `/verify` recovery flow.
3. **Sandbox documentation** — surface Phase 5 experimentally in docs.agentdrive.sh. Honest framing ("requires Cloudflare Containers plan; experimental").
4. **First 3 enterprise discovery calls** — Segment 3 outreach from [ICP.md](./ICP.md). Even at 0% close, these inform v1.5 SOC2 scoping.
5. **Quota enforcement gate** — turn on at 10 paid customers per [MONETIZATION](./MONETIZATION.md).

## v1.5 — within 60 days of v1 launch

Post-launch sprint. Lower intensity. Now that BYO-bucket is shipped in Phase 4, v1.5 is more about expansion than core fills.

**Items, prioritized:**

1. **GCS + Azure bucket providers** — extend BucketDriver abstraction to two more clouds. Strengthens the portability differentiator against Cloudflare Agent Memory, but does not replace the need for provenance/integration depth.
2. **Python SDK (`agentdrive-py`).** For LangGraph / CrewAI / AutoGen users who don't speak MCP. Publish to PyPI.
3. **Auto-extracted facts (`drive_recall` becomes real).** On `drive_write`, optionally extract structured facts (preferences, decisions, key entities) via LLM. Store in a `facts/` KV namespace.
4. **SOC2 Type 1 kickoff.** Pick a vendor (Vanta, Drata). Solo-founder timeline ~9 months. Per [MRR-PLAN](./MRR-PLAN.md), kickoff triggered at $40K MRR.
5. **D1 or Postgres migration plan drafted.** Not executed — KV holds. Document threshold (">100k files in a single workspace" or "first paying Enterprise customer requests complex queries").
6. **Logpush to R2** for Workers Logs. Currently logs live only in CF dashboard.
7. **Customer-managed keys (CMK) on Enterprise.** Beyond current envelope encryption — customer holds the KEK.
8. **Sandbox stabilization** — promote from experimental to stable if Phase 5 usage data justifies.

---

## Out of scope for v1 and v1.5

These are tempting and explicitly excluded:

- **Real-time collab CRDT/OT** (`FileCollab` Durable Object) — parked
- **Tiptap WYSIWYG editor** — agents don't need it
- **Frontend dashboard polish beyond [UX.md](./UX.md) High-priority items** — engineering time goes to agent surface
- **Multi-cloud control plane** (AgentDrive Worker on AWS/GCP) — Cloudflare-only for control plane is fine; portability is at the **bucket** layer (BYO-bucket), not the control plane
- **D1 / Postgres migration** — KV holds; trigger documented in v1.5 plan
- **Knowledge-graph reasoning** — Zep wins there; don't try

---

## Risks to this sprint

| Risk | Mitigation |
|---|---|
| Embeddings cost spike on backfill | Idempotent design + current BGE pricing (~$0.067/1M input tokens) should keep beta corpora affordable; re-check before large backfills |
| MCP SDK breaking changes between Anthropic releases | Pin `@modelcontextprotocol/sdk` to a known-good minor; test before bumping |
| Vectorize rate limits during launch traffic spike | Workers AI batch endpoint + Cloudflare rate-limit headers + retry-with-backoff in `services/embeddings.ts` |
| Conductor team unresponsive on companion mode | Ship without — Conductor users self-serve via the standard MCP install |
| Show HN timing collides with a competitor launch | Watch Mem0 / Letta / Anthropic blog feeds in Week 5; reschedule if needed |
| Solo-founder bandwidth: AgentDrive is 1 of 30 projects | 4–6 week focused window is the discipline; revisit at 90-day kill criteria |

Track these weekly. If two materialize in the same week, cut scope, do not push the launch.

---
**Owner:** Rakesh Roushan · **Last reviewed:** 2026-06-21 · **Review by:** 2026-09-21
