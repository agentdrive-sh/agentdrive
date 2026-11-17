# ADR-0007: Cross-agent identity — one principal, per-request platform header

**Status:** Accepted — 2026-05-16

## Context

The defining problem AgentDrive solves is "an artifact written by Codex is invisible to Claude Code." Solving it requires recording, on every write and every read, *which agent on which tool* performed the operation — not just which API key.

The default naïve model — "one API key per agent" — collapses the question into "different agents have different keys." But that loses the unified-workspace property: if Claude Code and Codex have separate keys, they can't see each other's writes without explicit sharing, defeating the value proposition. It also produces N keys for a single human, which doesn't match user intuition or the per-principal seat pricing model.

## Decision

An API key represents a **principal** — a human or a team — not an agent. The same key is used by Claude Code, Codex, Cursor, and LangGraph simultaneously.

Two HTTP headers, stamped on every authenticated request, distinguish which agent on which platform is calling:

- `X-Agent-Platform` — enum: `claude-code | codex | cursor | langgraph | crewai | autogen | hermes | openclaw | unknown` (defined in `packages/shared/src/types.ts` as `AgentPlatform`).
- `X-Agent-Role` — free-form, capped at 64 chars (e.g. `planner`, `reviewer`, `qa`).

The MCP server stamps these from env vars (`AGENTDRIVE_AGENT_PLATFORM`, `AGENTDRIVE_AGENT_ROLE`). The SDK and CLI accept them as constructor / flag arguments. The REST API requires them to be set on the request — if absent, the worker records `agent_platform = unknown`.

Provenance fields on `FileMeta`, `FileVersion`, `Comment`, `Activity`, and `AgentRun` records carry both `agent_id` (the principal) and `agent_platform` (per-request). The `/v1/org/timeline` endpoint aggregates by both, so a dashboard view can answer "what did Codex write today?" and "what did this person write across all their tools today?"

## Consequences

**Easier:**

- One key per human / team. Matches user intuition; matches per-seat pricing.
- Cross-agent visibility is the default — every read sees everything the principal wrote, regardless of which tool wrote it.
- Provenance graphs ("Claude Code authored → referenced by Codex") fall out of the data model without extra plumbing.
- Adding a new agent platform is one enum entry in `packages/shared` + one env-var default in the MCP server.

**Harder:**

- Headers are caller-asserted; a malicious caller can claim to be `cursor` when they're actually `unknown`. We accept this — the principal is authenticated by the API key, which is the security-critical part. Lying about the platform damages only your own provenance log.
- Role strings have no schema — they're free-form. Style guidance lives in the MCP server docs (`packages/mcp-server/README.md`).

## Alternatives considered

- **One API key per agent.** Loses unified workspace; complicates pricing; produces N-key key management UX.
- **Auth-encoded platform.** Issue separate JWTs per platform from a single root credential. Adds a token-exchange step on every install; loses simplicity.
- **Audit-only field — don't carry into the data model.** Loses the ability to filter provenance by platform in queries. The `agent_platform` field is queried often enough (timeline view, search filters) that it earns its place.

## References

- `packages/shared/src/types.ts` — `AgentPlatform` enum and the data-model fields.
- `apps/worker/src/middleware/auth.ts` — header parsing.
- `apps/worker/src/services/timeline.ts` — per-platform aggregation.
- `packages/mcp-server/src/index.ts` — env-var → header stamping.
- ADR-0003 — the MCP transport that this rides on.
