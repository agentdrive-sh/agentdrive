---
title: Cross-agent identity
description: 'One API key is one principal across many agent platforms. Platform and role headers on each request give every session its own provenance in AgentDrive.'
---

A persistent workspace is only useful if the platform underneath it knows who wrote what. AgentDrive's identity model is built so that the same principal can act through Claude Code on Tuesday, Codex on Wednesday, and Cursor on Thursday, and the audit trail tells you all three without forcing you to manage three keys.

## The principal model

An API key represents a **principal** — a human or a team — not a single agent process. The principal is the durable identity that owns workspaces, holds the plan, and receives the bill.

Each request from an agent declares two things about itself:

- `X-Agent-Platform` — which client is making the request: `claude-code`, `codex`, `opencode`, `cursor`, `gemini-cli`, or a custom-agent label (`langgraph`, `crewai`, `autogen`, `hermes`, `openclaw`). Any other value is recorded as `unknown`.
- `X-Agent-Role` — what the agent is doing in this session: `planner`, `coder`, `reviewer`, `qa`, `researcher`, or `other`

The worker reads these headers into the request identity. Agent activity and run records carry platform; run records can also carry role. File, version and comment records retain actor identifiers but do not all store platform or role.

## What this gives you

- **One install, many platforms.** A solo developer running Conductor with three parallel Claude Code worktrees plus a Codex session plus a Cursor window installs one MCP server, one API key. Every artifact is attributable.
- **Provenance that survives platform churn.** When you swap Claude Code for the next thing in six months, the historical record still says "the planner that produced this artifact was Claude Code, on this date, under this principal."
- **Role labels.** Agent run records can carry a caller-supplied role. Artifact search does not expose a role or time-window filter.

## How the MCP server populates these headers

The MCP server reads `AGENTDRIVE_AGENT_PLATFORM`, defaulting to `unknown`. Roles can be set with `AGENTDRIVE_AGENT_ROLE`; the default is empty.

For non-MCP clients calling the REST API directly, set both headers yourself. They are optional — requests without them use platform `unknown` and an omitted role — but they are the entire mechanism by which the cross-platform story becomes legible later.

## Shipping in v1

The principal model is live today as part of the API key system. The two identity headers, platform-aware activity and run provenance are available in v1. See the [v1 roadmap](/docs/v1-roadmap) for sequencing.
