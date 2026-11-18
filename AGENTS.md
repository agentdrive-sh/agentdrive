# AGENTS.md

Instructions for AI coding agents (Codex, Claude Code, Cursor, OpenCode, Antigravity and others) working in this repository.

## What this is

AgentDrive is a shared workspace that lets coding agents resume each other's sessions, with provenance on every artifact and portable storage. The backend is a Cloudflare Worker; metadata lives in Workers KV and file content in R2.

## Layout

Turbo monorepo with pnpm workspaces. Node 20; the pnpm version is pinned in `packageManager`.

- `apps/worker`: the Cloudflare Worker (Hono) that serves the REST API, the hosted MCP server and OAuth. AGPL-3.0.
- `apps/web`: the Next.js site, docs (`content/docs`) and dashboard, deployed with OpenNext. AGPL-3.0.
- `apps/installer`: the shell installer. Apache-2.0.
- `packages/mcp-server`, `packages/cli`, `packages/sdk-ts`, `packages/shared`: the stdio MCP server, the `adrive` CLI, the TypeScript SDK and shared types. Apache-2.0.
- `plugins/agentdrive`: the Claude Code plugin and its portable Agent Plugins manifest. Apache-2.0.

A new file takes the license of the package it lands in. Architecture and decision records are in `docs/tech/`.

## Commands

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm dev:worker   # API on http://localhost:8787
pnpm --filter @agentdrive/worker test
```

## Rules

- TypeScript only, pnpm only (never npm or yarn in the monorepo).
- Hono for routing, Zod for validation, the MCP SDK for tools. Do not add Express, Fastify or another validator.
- Do not add Postgres, D1 or another database. KV and R2 are the storage substrate; read `apps/worker/src/services/storage.ts` before changing any KV key shape, and never change one without a backfill.
- Enumerate KV with cursor pagination; never pass a `limit` above 1000.
- Compare permissions with `hasPermission`, never as strings.
- No emojis in code, comments or commit messages. Comments explain why, not what.
- No backwards-compatibility shims or half-finished stubs; delete dead code.
- Never commit secrets. `.dev.vars` is gitignored; production secrets are set with `wrangler secret put`.
- Never skip git hooks with `--no-verify`.
- Every change reaches `main` through a pull request with passing CI. External contributions need a signed CLA (`CLA.md`); see `CONTRIBUTING.md`.

## Tests

Vitest with `@cloudflare/vitest-pool-workers` under `apps/worker/test/`, and Vitest in each package. Add or update a test for every behavior you change. The highest-value surfaces are share-token signing and revocation, API-key hashing, the permission ladder and `/v1/register`.
