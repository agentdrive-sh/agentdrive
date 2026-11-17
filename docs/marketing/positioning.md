# POSITIONING — How We Talk About AgentDrive

**Date originally locked:** 2026-05-15
**Last refreshed:** 2026-11-02 (launch: session continuity leads; Free/Pro/Team/Enterprise)
**Owner:** founder
**Authority:** Anything in this file overrides ad-hoc copy elsewhere. If you find drift, fix it here first, then propagate.

See [PIVOT](./PIVOT.md) for the strategic context behind these decisions, [MARKET](./MARKET.md) for the sourced competitor data driving the 2026-05-23 refresh, and [COMPETITIVE](./COMPETITIVE.md) for the language we use against incumbents.

---

## Locked one-liner (refreshed 2026-11-02)

> **AgentDrive — the shared workspace that lets Claude Code, Codex, OpenCode, Cursor, Gemini CLI, and Antigravity pick up each other's sessions, with provenance on every artifact and portable storage.**

Three-word frame: **Continuity. Provenance. Portable.**

Use this verbatim wherever a single sentence is required. Do not paraphrase. If there is room for a second sentence, add: **Bring your own bucket: R2, S3, or customer-owned storage.** The bucket clause is a differentiator against Cloudflare Agent Memory, but do not describe it as the entire moat.

### What changed from the 2026-05-23 lock
- **Session continuity leads.** Background capture + cross-harness resume shipped 2026-10-22 (CLI 1.1.x, MCP 1.1.x). It is the thing users feel first: start a task in one agent CLI, finish it in another. Workspace, provenance and portable storage are now the supporting pillars, not the headline.
- **Platform list is the six harnesses with capture support**, in this order: Claude Code, Codex, OpenCode, Cursor, Gemini CLI, Antigravity. Cline, Zed and Continue get the workspace tools as plain MCP clients (no capture); say so separately. Do not list LangGraph, AutoGen or CrewAI as supported: nothing in the code backs them.

### What changed from the 2026-05-15 lock
- Replaced **"memory"** with **"provenance"** in the headline — Mem0/Zep/Anthropic/Cloudflare own "memory." AgentDrive owns "who did what, when, with what tools, on what artifact" — the audit graph.
- Kept **portable storage** — this is a differentiator against Cloudflare Agent Memory, not a guarantee Cloudflare cannot respond.
- Kept platform list (Claude Code, Codex, Cursor) — still correct. Expanded LangGraph → "your custom agents" to accommodate CrewAI / Hermes / OpenClaw users.

---

## Taglines by surface

Different surfaces have different character budgets and audiences. Each tagline is a compression of the one-liner, never a contradiction of it.

### Homepage hero (`agentdrive.sh`)

> **Start in any agent. Finish in any other.**
> Hit a usage limit in one coding agent? Keep going in another. AgentDrive syncs every session, transcript and file your coding agents produce into one shared workspace, so any agent can resume where another left off. Provenance on every artifact. Storage on R2, S3, or your own bucket.

Never lead with Claude Code to Codex alone: Codex imports Claude Code sessions natively (one way, no export), so demos show the directions vendors don't build, such as Codex into Claude Code.

### MCP marketplace listings (Smithery, Glama, mcp.so, PulseMCP)

> Shared workspace for coding agents: capture sessions from Claude Code, Codex, OpenCode, Cursor, Gemini CLI and Antigravity, resume them in any of the others, and search everything they wrote. Provenance on every artifact; portable storage on R2, S3 or your own bucket.

### Cursor / Cline / Continue / Zed MCP directory blurb

> AgentDrive — shared workspace and provenance for agents. Read what your other agents wrote and resume their sessions. 22 MCP tools (18 stable + 4 experimental sandbox): files, versions, semantic search, run logs, session handoff, and BYO bucket on R2 / S3.

### GitHub repo description (≤350 chars)

> Shared workspace that lets Claude Code, Codex, OpenCode, Cursor, Gemini CLI and Antigravity resume each other's sessions, with provenance and portable storage. MCP server + CLI + TypeScript SDK.

### npm package descriptions

- `@adrive/mcp-server`: "MCP server for AgentDrive — cross-agent artifact workspace with provenance and portable storage."
- `@adrive/cli` (`drive` binary): "Wire AgentDrive into every agent on your machine in one command."
- `@adrive/sdk`: "TypeScript SDK for AgentDrive — artifact workspace + provenance + semantic recall for multi-agent apps."

### Show HN post title

> Show HN: AgentDrive – hit a limit in one coding agent, finish the task in another (any direction)

### Twitter / X bio

> Start in any agent, finish in any other. Session handoff across Claude Code, Codex, OpenCode, Cursor, Gemini CLI and Antigravity, with provenance and portable storage on R2, S3, or your own bucket. agentdrive.sh

### Conductor community announcement

> If you run more than one agent in parallel, AgentDrive is the shared workspace that ties them together. Codex writes A. Claude Code reads A. Cursor sees the run log. Bring your own bucket if you want it on your cloud. One MCP install, every agent.

---

## ICP (canonical reference: [ICP.md](./ICP.md))

The three named segments and their willingness-to-pay live in [ICP.md](./ICP.md). Short version for copy purposes:

- **Segment 1 — Indie multi-agent developer** (wedge). 200K–500K worldwide (Claude Code 4.2M WAU × 5–10% multi-platform overlap). Pro $20/mo.
- **Segment 2 — AI-native Series A team** (expansion). 3K–8K globally. Team $30/seat/month, 3-seat minimum; Enterprise custom.
- **Segment 3 — Enterprise data-residency buyer** (future). 50–200 named accounts. Enterprise $2K–$10K/mo.

When writing copy, default to Segment 1 voice unless the surface is explicitly Team-tier+ (BillingPage, BucketConfigPage, partnerships).

---

## What we don't say

### We do not call ourselves a "memory layer"

Mem0 ($24M Series A, 80K developers, 41K stars, exclusive AWS Agent SDK provider), Zep, Letta, Cognee, LangMem, Supermemory all own that frame. As of 2026, the memory category has a leader and we will not become it. Instead:

- We say: **"artifact workspace + provenance + portable"** (the locked frame)
- We say: "shared workspace, with memory as a feature on top"
- We say: "the audit and identity graph above any memory layer"
- We do not say: "AgentDrive is a memory layer"
- We do not say: "we replace Mem0 / Zep / Letta"

When asked "are you a memory layer?", the correct answer is: "We're a shared workspace with provenance. Memory and semantic recall are features on top of the workspace. If you only need long-term semantic recall for chat history, Mem0 is great. If you need agents in different tools to read and write the same artifacts with full audit trail, on whatever cloud bucket you choose, you need a workspace — and that's what we are."

### We do not call ourselves "Cloudflare-native" — added 2026-05-23

Reason: Cloudflare Agent Memory shipped April 2026 as a managed product on the same substrate. If we frame ourselves as "Cloudflare-native," we lose the BYO-bucket moat. Instead:

- We say: "built on Cloudflare, portable to your cloud"
- We say: "on R2 today, S3 today, GCS / Azure next"
- We do not say: "Cloudflare-native"
- We do not say: "Cloudflare-only"

### We do not pitch CRDT, real-time collab, or WYSIWYG editing

These exist in the codebase as stubs (`FileCollab` Durable Object). They are not part of the v1 story. If asked, the answer is "parked — not what users are asking for."

### We do not pitch generic file sharing for humans

We have share links and comments. They are not the headline. They are a feature for the human-in-the-loop case, not a horizontal Dropbox replacement.

---

## Competitive language

### Against Anthropic Memory Tool and OpenAI ChatGPT Memory

> Anthropic's managed-agent memory gives Claude shared stores, filesystem-mounted memory, scoped permissions, and audit logs inside Claude. ChatGPT Memory is expanding across past chats, files, and connected sources inside ChatGPT. AgentDrive is narrower and more neutral: the shared workspace that spans Claude Code, Codex, OpenCode, Cursor, Gemini CLI, Antigravity and any MCP client, with portable storage and provenance outside any one model vendor.

### Against Mem0, Zep, Letta, Supermemory

> Mem0, Zep, Letta, and Supermemory own semantic memory for chat agents. AgentDrive owns the workspace, provenance, and identity layer above memory. We're not competing for "remember the user's name" — we're competing for "your Codex agent should see what your Claude Code agent shipped this morning, with the full audit trail, on whatever cloud bucket you choose."

### Against Cloudflare Agent Memory (added 2026-05-23)

> Cloudflare Agent Memory is a managed memory product on Cloudflare's substrate. We use the same substrate, which is both a risk and an advantage. The difference today: AgentDrive ships cross-agent artifact provenance plus BYO-bucket on R2, S3, your own AWS account, and next GCS / Azure. If your workflow spans Claude Code, Codex, OpenCode, Cursor, and customer-owned storage, you need the portable artifact layer above memory.

### Against filesystem MCP / GitHub MCP

> Filesystem MCP is local-only. GitHub MCP is git-centric, slow, forces branch overhead onto agent workflows. AgentDrive is the shared blob store both lack — versioned, content-addressed, semantically searchable, with provenance, portable across clouds.

---

## House style for AgentDrive copy

- **Tone:** developer-direct. Plain. No marketing fluff. No "revolutionary." No "next-gen."
- **Verbs:** read, write, share, recall, log, find, persist, route, verify
- **Nouns:** workspace, artifact, run, principal, agent, platform, provenance, bucket, locator
- **Banned phrases:** "AI-powered," "the future of work," "seamless," "leverage," "enterprise-grade" (until SOC2 ships), **"memory layer"** (Mem0 owns that), **"Cloudflare-native"** (kills BYO-bucket positioning), **"Switzerland for agent memory"** (old overbroad frame), "Drive for agents" (old frame), "cowork" (old frame)
- **Mandatory phrases** (drift-detection requires at least one in headline copy): **"portable across clouds,"** **"bring your own bucket,"** **"provenance graph,"** **"shared workspace"**
- **Numbers we cite:** 6 harnesses with session capture + resume (Claude Code, Codex, OpenCode, Cursor, Gemini CLI, Antigravity), 22 MCP tools (18 stable + 4 experimental sandbox), $0 egress on R2, three bucket providers (R2 default / Cloudflare R2 cross-account / S3-HMAC), Phase 4 multi-cloud shipped 2026-05-19, Phase 5 sandbox shipped same window
- **Numbers we do not invent:** TAM, growth rates, customer counts. Cite real ones from [MARKET.md](./MARKET.md) or do not cite.

---

## Drift detection (refreshed 2026-05-23)

When in doubt, run the one-liner test: open the surface, find the first paragraph describing what AgentDrive does, and verify it contains:

1. The word **workspace**
2. The harness list **Claude Code, Codex, OpenCode, Cursor, Gemini CLI, Antigravity** (or the H1 pair "Claude Code … Codex" — order matters, Claude Code first)
3. The words **portable** OR **bring your own bucket** OR **on R2, S3, or your own bucket** somewhere in the first viewport
4. Either **provenance** or **audit** in the same paragraph as the platform list

If any of those are missing, fix it. If any surface says "memory layer" or "Cloudflare-native" as the headline, fix it immediately — those are the two phrases that lose us positioning against the two named competitors that drove the 2026-05-23 refresh.
