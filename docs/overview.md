# AgentDrive — Overview

> **One-liner:** The cross-agent artifact workspace with provenance and portable storage across Claude Code, Codex, Cursor, LangGraph, CrewAI, AutoGen, and custom agents.

The single cold-start doc. Read this and you know what AgentDrive is, how to run it, and where everything lives.

## What & why
- **Problem:** An artifact written by Codex is invisible to Claude Code, and an agent that wrote a long-running plan in one session has no durable handoff to the next. Agent-produced artifacts and context are trapped per-tool and per-session.
- **Who it's for:** Developers running multi-agent workflows across multiple agent platforms who need a neutral, shared layer for the artifacts and context their agents produce.
- **What we're building:** One workspace for agent artifacts, semantic recall, provenance for every agent action, and portable storage you can point at your own bucket (R2 cross-account or any S3-compatible endpoint). The integration surface is MCP-first, with a REST API, TypeScript SDK, and CLI on top of the same Cloudflare Worker backend.
- **Stage:** active
- **Status right now:** Private beta, live at `https://app.agentdrive.sh`. MCP server (20 tools), TypeScript SDK, CLI (17 commands), REST API, one-line installer, content-addressed encrypted storage, semantic search, and BYO-bucket are all live. Stripe billing is scaffolded but quotas are not yet enforced. Per-workspace Linux sandbox is experimental (requires Cloudflare Containers plan). Broad public launch is gated on dogfood/activation criteria.

## How to run it
```bash
pnpm install            # Node 20, pnpm 10.13.1 pinned via packageManager
pnpm dev:worker         # local Cloudflare Worker (wrangler dev) — API at http://localhost:8787
pnpm dev:frontend       # local Vite SPA dashboard
pnpm dev:docs           # local Astro Starlight docs site
pnpm build              # turbo build across all workspaces
pnpm typecheck          # turbo typecheck across all workspaces
pnpm test               # vitest across the worker and packages
```
Install for end users:
```bash
curl -fsSL app.agentdrive.sh/install | sh
```
- **Prod URL:** https://app.agentdrive.sh (docs at https://docs.agentdrive.sh)
- **Repo:** https://github.com/agentdrive-sh/agentdrive
- **Deploy:** `pnpm --filter @agentdrive/worker run deploy` publishes the Worker. CI (`.github/workflows/ci.yml`) gates every PR on typecheck + test + build.

## Where things are
| Area | Location |
|------|----------|
| Backend / API | `apps/worker/` (Hono on Cloudflare Workers — the entire backend) |
| Web app / dashboard | `apps/web/` (Next.js marketing + app shell), `apps/frontend/` (legacy React 19 + Vite SPA, being migrated) |
| Public docs site | `apps/docs/` (Astro Starlight, docs.agentdrive.sh) |
| Installer | `apps/installer/` (curl-pipe-bash one-line install) |
| MCP server | `packages/mcp-server/` (stdio MCP, 20 tools — primary integration surface) |
| SDK | `packages/sdk-ts/` (`@adrive/sdk`) |
| CLI | `packages/cli/` (`adrive` binary) |
| Shared types | `packages/shared/` (types, ids, HMAC token sign/verify, Zod schemas) |
| Storage code | `apps/worker/src/services/storage.ts` (KV + R2; no Postgres/D1) |
| Auth | `apps/worker/src/middleware/auth.ts` (API key / share token / session) |
| Tests | `apps/worker/test/` (vitest + @cloudflare/vitest-pool-workers) |

## Top 5 decisions to know
1. KV + R2 are the only storage substrate — no Postgres/Neon/D1 — see [[tech/adr/0001-kv-and-r2-as-storage-substrate]]
2. Hono on Cloudflare Workers is the API runtime — see [[tech/adr/0002-hono-on-cloudflare-workers]]
3. MCP is the first-class integration surface; REST/SDK/CLI sit on top — see [[tech/adr/0003-mcp-first-integration-surface]]
4. Split license — AGPL-3.0 for the server (worker, web, frontend), Apache-2.0 for the client packages — see [[tech/adr/0009-agpl-server-license]]
5. Cross-agent identity: one API key is a principal; per-request `X-Agent-Platform`/`X-Agent-Role` headers distinguish each agent in provenance — see [[tech/adr/0007-cross-agent-identity-principal-plus-platform]]

## Key links
- **Architecture:** [[architecture]] · **GTM:** [[positioning]] · **Roadmap:** [[roadmap]]
- **Contributor guide:** `CLAUDE.md` · **Design tokens:** `DESIGN.md` · **Licensing:** `LICENSING.md`
- **ADRs:** [[tech/adr/README]]

---
**Owner:** Rakesh Roushan · **Last reviewed:** 2026-06-21 · **Review by:** 2026-09-21
