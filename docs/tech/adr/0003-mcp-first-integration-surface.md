# ADR-0003: MCP as the first-class integration surface

**Status:** Accepted — 2026-05-15

## Context

AgentDrive's value proposition is "every agent sees the same workspace." That requires an integration protocol that every relevant agent host already speaks, with a tool-shaped surface so agent runtimes can call AgentDrive without bespoke glue per host.

As of May 2026, the Model Context Protocol (MCP) has converged as the lingua franca: Anthropic Claude Code, OpenAI's ChatGPT Connectors, Google Gemini, Microsoft (VS Code + Copilot Studio), Cursor, Windsurf, Zed, Cline, and Continue all consume MCP servers. Building MCP-first is durable; building a proprietary protocol first is friction.

## Decision

The **stdio MCP server** (`packages/mcp-server`, published as `@adrive/mcp-server`) is the primary integration surface for AgentDrive. It exposes 20 tools (16 stable + 4 experimental sandbox) that wrap the REST API one-to-one. Every public capability ships as a tool *before* it ships as a CLI command or SDK method.

The REST API (`/v1/*`) is the universal fallback — anything that doesn't speak MCP can speak HTTP+JSON. The CLI (`@adrive/cli`) and TypeScript SDK (`@adrive/sdk`) sit on top of the REST API, not on top of MCP.

The MCP server stamps cross-agent identity headers (`X-Agent-Platform`, `X-Agent-Role`) on every outgoing request so the worker records which agent on which platform performed each operation. Defaults are `claude-code` / `agent`, overridable via `AGENTDRIVE_AGENT_PLATFORM` and `AGENTDRIVE_AGENT_ROLE` env vars.

## Consequences

**Easier:**

- Distribution: agent hosts already have an MCP installer flow. The one-line install (`curl … | sh`) auto-detects and wires the MCP config for every supported host.
- API design discipline: a tool surface has to be self-describing (JSON Schema in the tool definition). That pressure produces a better REST API.
- Cross-host portability: switching from Claude Code to Codex doesn't change the AgentDrive surface, only which host is reading the same workspace.

**Harder:**

- We're betting on a protocol we don't control. If a major host drops MCP, the one-line install loses one of its targets.
- 20 tools is the right surface today; it's also the surface that has to stay stable as v1 evolves. Adding a 21st tool needs to clear a "do agents need this enough to put a tool in their face?" bar.
- Tool definitions and REST endpoints have to track each other. We mitigate via tests in `packages/mcp-server/test/` that exercise the tool→REST round-trip.

**Hedge against protocol risk:** the four-surface play (MCP server, REST API, CLI, TypeScript SDK) means a single MCP-protocol shock doesn't kill the product. The CLI and SDK keep working over plain HTTPS.

## Alternatives considered

- **OpenAI's function-calling protocol as primary.** Tied to OpenAI's models. Loses Claude Code, Cursor, Zed.
- **LangChain Tools / LangGraph as primary.** Tied to a single agent framework. LangGraph users get MCP support via Cline-style adapters anyway.
- **Proprietary protocol.** Maximum control, zero adoption. Rejected.
- **REST API only, no MCP.** Possible, but loses the discoverable-tool affordance that makes AgentDrive feel native inside Claude Code / Cursor.

## References

- `packages/mcp-server/src/index.ts` — tool registry.
- `packages/mcp-server/README.md` — published surface.
- ADR-0007 — the identity-header model that piggybacks on the MCP transport.
