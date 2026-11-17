# AgentDrive — PRD

> **Scope:** Product-level PRD for the AgentDrive v1 surface — the cross-agent artifact workspace (MCP server, REST API, SDK, CLI, dashboard, BYO-bucket). Per-feature PRDs should be added as separate docs as features are specced.

## Goal
{Restate as measured outcomes. Draft inferred from the repo: let a developer's agents on different platforms (Claude Code, Codex, Cursor, LangGraph, CrewAI, AutoGen) read and write the same artifacts with provenance and semantic recall, so that cross-agent workspaces become sticky and convert to paid Pro/Team tiers. Confirm the activation + revenue targets from [[mrr-plan]] and [[../ops/metrics]].}

## Users & jobs
Developers running multi-agent workflows who need a neutral shared layer for agent-produced artifacts and context. The six named jobs are documented in [[jtbd]]; end-to-end call sequences in [[flows]].

## Requirements
### Must have (live today)
- [x] MCP server with the 20 `drive_*` tools (files, collaboration, provenance, org, memory + runs)
- [x] REST API (`/v1/*`): register, files CRUD + versions, shares, comments, activity, orgs, search, runs, context, bucket-config
- [x] TypeScript SDK (`@adrive/sdk`) and CLI (`@adrive/cli`, binary `adrive`)
- [x] One-line installer that auto-wires MCP into supported agents
- [x] Three-mode auth (API key / HMAC share token / magic-link session + OAuth)
- [x] Content-addressed encrypted storage with metadata + vector index (semantic recall)
- [x] BYO-bucket (R2 cross-account / S3-compatible) with verify recovery and auto-degrade
- [x] Next.js dashboard at app.agentdrive.sh

### Should have (path forward — see [[roadmap]])
- [ ] MCP marketplace + IDE directory submissions (Smithery, Glama, mcp.so, Cursor, Cline, Continue, Zed)
- [ ] Quota enforcement gate wired to Stripe (after 10 paying customers)
- [ ] Python SDK (`adrive-py`) for LangGraph / CrewAI / AutoGen
- [ ] Auto-extracted facts (`drive_recall` graduates to a real fact namespace)
- [ ] GCS + Azure bucket drivers
- [ ] SOC2 Type 1 (kickoff at $40K MRR)

### Non-goals (explicitly out of scope for v1)
- Real-time collaborative editing (OT/CRDT) — the `FileCollab` Durable Object is parked
- WYSIWYG editor — agents don't need one
- Knowledge-graph reasoning
- Multi-cloud control plane

## Success metrics
{The activation gate for broad launch (from the strategy README / kill-criteria) is: 10+ dogfood installs, 5+ real cross-agent workspaces, 3+ returning principals, 1+ paid Team-intent conversation, and consistent public pricing/positioning across all surfaces.}

## Open questions
- {When exactly does quota enforcement flip on, and how is it staged to avoid support load with zero revenue upside? → Decisions DB}
- {Python SDK parity scope vs. MCP-only — which workflows truly cannot speak MCP? → Decisions DB}
- {Per-feature PRDs still to be written for: auto-extracted facts, sandbox GA, marketplace listings.}

---
**Owner:** Rakesh Roushan · **Last reviewed:** 2026-06-21 · **Review by:** 2026-09-21
