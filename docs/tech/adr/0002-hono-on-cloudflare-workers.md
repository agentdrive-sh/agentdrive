# ADR-0002: Hono on Cloudflare Workers as the API runtime

**Status:** Accepted — 2026-05-15

## Context

AgentDrive's API needs to be globally distributed, sub-100ms on warm reads, and cheap at zero traffic. The product is a sidecar to agent workflows; users may invoke it from any region. A traditional Node-on-VM or Node-on-Lambda deployment carries cold-start tax, regional latency, and an idle-instance bill.

The Worker runtime is V8 isolates, so every npm-Node-compatible HTTP framework (Express, Fastify, Koa, etc.) is the wrong shape — they assume Node's `http` module and a single long-lived process. We need a router that's idiomatic to the Workers runtime.

## Decision

Use **Hono** as the HTTP router and request lifecycle layer, running on **Cloudflare Workers** with `nodejs_compat` enabled and `compatibility_date = "2025-02-20"`.

Routing is mounted from `apps/worker/src/index.ts` to per-domain route modules under `apps/worker/src/routes/` (files, workspaces, shares, comments, activity, orgs, auth, search, runs, context, bucket-config, sandbox, …). Validation is **Zod** on every request body. Tools that need to call out to MCP clients are wired through the **MCP TypeScript SDK** (`@modelcontextprotocol/sdk`) — separately, in `packages/mcp-server`.

The decision is documented as a hard constraint in the house style in `CONTRIBUTING.md`: *Hono for routing, Zod for validation, MCP SDK for tools — don't introduce Express/Fastify/io-ts/etc.*

## Consequences

**Easier:**

- Worker-native ergonomics. Bindings (`KV`, `R2`, `VECTORIZE`, `AI`, `SANDBOX`) are typed and passed through context with no glue.
- ~0 ms cold start. Isolates spin up in single-digit milliseconds.
- Egress-free reads of R2 from the same Worker. The metadata edge is the storage edge.
- Tree-shakeable. The deployed bundle is single-digit MB, well under Worker size limits.

**Harder:**

- Anything that assumes Node's filesystem, child processes, or long-lived sockets does not work. Vendor libraries get audited before they're pulled in.
- 50 ms CPU-time budget on the free plan, 30 s on paid. Cryptographic work (HKDF, HMAC, AES-GCM) goes via the Web Crypto API rather than Node's `crypto`.
- The runtime is *not* "Node on V8" — it's "Workers Runtime, with a Node compat shim." Subtle behavior differences from Node show up in tests; we run `@cloudflare/vitest-pool-workers` to make those visible early.

## Alternatives considered

- **Express on Workers.** Doesn't fit the runtime shape; would require an adapter.
- **itty-router.** Lighter than Hono but lacks middleware composition. The auth middleware shape (`flexAuth`) is easier in Hono's typed context.
- **Cloudflare Pages Functions.** Same runtime, but the file-routing model fights us when we want module-level mounting. Pages is appropriate for `apps/web`; Workers (with explicit `wrangler deploy`) is appropriate for the API.
- **Plain `addEventListener('fetch', …)`.** Workable but reinvents routing. Hono's overhead is negligible.

## References

- `apps/worker/src/index.ts` — the wiring file.
- `apps/worker/src/routes/` — per-domain mounts.
- `apps/worker/wrangler.toml` — runtime config.
- `CONTRIBUTING.md` — house style.
