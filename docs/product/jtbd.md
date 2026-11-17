# JTBD — Jobs to be done

**Last updated:** 2026-05-23
**Purpose:** the six named jobs AgentDrive is hired for. Each job is derived from the actual MCP tool surface (`drive_*`) and the actual `/v1/*` endpoint set; nothing invented.

See [ICP](./ICP.md) for who hires AgentDrive for these jobs, [FLOWS](./FLOWS.md) for the call sequences that satisfy each one, and [UX](./UX.md) for the screens that surround them.

Job-statement format follows Clayton Christensen's standard: *"When [situation], I want to [motivation], so I can [expected outcome]."*

---

## Job 1 — Continue a task I started on another agent

**Job statement.** When I plan a feature in Claude Code, switch tabs to Codex to implement it, then open Cursor for review, I want my context, decisions, and partial artifacts to be visible to the next agent so I don't repeat myself.

**Frequency.** Multiple times per day for the wedge ICP. The single most-used JTBD.

**Current alternative (what they do without AgentDrive).**
- Copy-paste the design doc from Claude Code chat into Codex chat
- Re-summarize "what we decided yesterday" in 200 words at the top of each new session
- Maintain a `current-state.md` file in the repo and manually paste into agents' context

**Success metric.** Time from "I open the second agent" to "the second agent has the context the first agent produced" — target <10 seconds, including the `drive_context` call.

**Satisfied by.**
- `drive_context(task, workspace, limit)` — semantic + recency rerank, returns top-N relevant artifacts and last-N run summaries
- `drive_log_run({task, status, artifacts_produced, tool_calls})` — the first agent logs what it did so the next agent has structured handoff
- `drive_recall(query, workspace)` — pull preferences and decisions from prior sessions

**Tier gating.** Free tier covers JTBD 1 at low volume. Pro unlocks unlimited workspaces + 1M embeddings, which is where serious multi-agent workflows live.

---

## Job 2 — Audit what an agent actually did

**Job statement.** When a deploy breaks or a customer complains, I want a record of every tool call, file read, file written, and decision made by every agent — so I can debug without re-running the agent or guessing.

**Frequency.** Sporadic — but every incidence is high-pain. Often the trigger that converts Segment 2 from "evaluating" to "paying."

**Current alternative.**
- Grep agent chat logs (if they exist, if they're complete)
- Re-run the agent with `--verbose` and hope the bug reproduces
- Read git history backwards, infer agent activity from commit messages
- File a ticket and move on

**Success metric.** Time from "something broke" to "I have the agent run that caused it" — target <60 seconds. Run record includes platform, principal, task, tool calls, artifacts touched, duration, status.

**Satisfied by.**
- `POST /v1/runs` (called by agents via `drive_log_run`) → `GET /v1/runs?agent_id&cursor` (queried by humans)
- `drive_activity(workspace, limit)` — recent workspace events (writes, comments, shares)
- File versioning (`/v1/workspaces/:wid/files/:fid/versions`) — see exactly which version broke what
- `/v1/org/timeline` (Phase 3) — org-wide activity feed, filterable by `agent_platform`

**Tier gating.** Pro = 30-day run log retention. Team = 1-year retention + RBAC on who can see runs. Business+ = audit log export.

---

## Job 3 — Share an artifact with a human

**Job statement.** When an agent produces a design doc, spec, report, or any deliverable, I want to share it with a teammate or customer over a link, optionally with comments, without giving them access to my whole workspace.

**Frequency.** Lower volume than JTBD 1/6, but every event is a viral surface (the recipient sees AgentDrive's brand).

**Current alternative.**
- Copy-paste artifact into Notion / Google Doc, share that
- Slack the file directly (lose version history + provenance)
- Email an attachment

**Success metric.** Time from "agent finished writing" to "human has a clickable link" — target <5 seconds. Token must be HMAC-signed, optionally email-gated, revocable.

**Satisfied by.**
- `drive_share(file_path, options)` — generates HMAC token, optionally email-gated, optionally max-uses, optionally expires
- `drive_comment(file_path, body)` — human leaves a comment, agent picks it up next session
- `drive_feedback(file_path)` — agent reads human comments
- Token-resolver page in frontend handles unauthenticated access via the share link

**Tier gating.** Free includes share links. Pro adds comment threading + email-gating. Team adds audit log of who-viewed-what.

---

## Job 4 — Keep my data on my own cloud

**Job statement.** When my org requires data residency (GDPR, HIPAA, sovereignty) or I just don't trust a startup with my IP, I want to point AgentDrive at my own S3, R2, GCS, or Azure bucket and have artifact content land there while metadata stays in AgentDrive.

**Frequency.** Rare to discover, mandatory once needed. Single highest-leverage moat against Cloudflare Agent Memory (which is structurally Cloudflare-only).

**Current alternative.**
- Refuse to use any cloud-hosted memory product → build internally
- Vendor risk-accept and use a US-only / Cloudflare-only product → reopens compliance debate every quarter
- Self-host an OSS alternative → maintenance overhead

**Success metric.** From "I have AWS credentials" to "next `drive_write` lands in my bucket" — target <5 minutes via UI, <60 seconds via API.

**Satisfied by.**
- `/v1/bucket-config` CRUD (Phase 4, shipped 2026-05-19) — three providers: R2 default, Cloudflare R2 cross-account, S3-HMAC
- `BucketDriver` abstraction in `apps/worker/src/services/` routes writes per workspace config
- Bucket-health auto-degrade (shipped 2026-05-22) — write failure 3x → bucket moves to read-only, `/verify` recovery surfaces the issue
- Frontend `BucketConfigPage` — **does not exist yet**, flagged as build-priority in [UX.md](./UX.md)

**Tier gating.** Team and above only. BYO-bucket is the explicit Team-tier wedge feature.

---

## Job 5 — Give an agent a real Linux sandbox

**Job statement.** When an agent needs to clone a repo, install dependencies, run tests, or execute a build, I want it isolated per workspace, not running on my laptop or in a shared environment that another agent could corrupt.

**Frequency.** New JTBD as of Phase 5 (shipped 2026-05-19, experimental). Volume unclear; this is the R&D bet.

**Current alternative.**
- Run the agent locally with full system access (security-yolo)
- Use a dev container in VS Code (works but locked to one editor)
- Spin up an EC2 / Fargate / Cloudflare Container manually per task (slow)

**Success metric.** Time from `drive_sandbox_clone` to first `drive_sandbox_exec` output — target <30 seconds. Per-workspace isolation enforced.

**Satisfied by.**
- `drive_sandbox_clone(repo_url)` — git clone into per-workspace sandbox
- `drive_sandbox_exec(command)` — shell execution
- `drive_sandbox_read(path)` — read file from sandbox filesystem
- `drive_sandbox_commit(message)` — stage + commit sandbox worktree as artifact back into AgentDrive

**Tier gating.** Pro tier and above (requires Cloudflare Containers binding on the AgentDrive worker). Returns 503 gracefully when binding absent — does not break the rest of the product for users without Containers plan.

**Status.** Experimental. Flagged `[EXPERIMENTAL]` in MCP tool descriptions. Not a v1 marketing headline. Pre-PMF.

---

## Job 6 — Remember things across sessions

**Job statement.** When I told the agent something last week — a preference, a project fact, a decision, a person's name, a constraint — I want the agent to remember it next time without me re-pasting.

**Frequency.** High — every session for power users.

**Current alternative.**
- Re-paste the same context block at the top of every session
- Maintain CLAUDE.md / AGENTS.md / .cursorrules with the persistent facts (works for static rules, brittle for evolving state)
- Use Anthropic Memory Tool (single-platform — works inside Claude only)
- Use Mem0 (chat-memory-first — works for conversational state, weaker for artifact-state)

**Success metric.** "Does the agent know the thing I told it last week without me prompting it?" Recall precision >70% at top-3 results for the wedge use case.

**Satisfied by.**
- `drive_recall(query, workspace, limit)` — auto-extracted facts (extraction lands in v1.5; v1 returns from manual writes tagged as facts)
- `drive_search(query, workspace, filters)` — semantic + keyword fallback over all artifacts in the workspace
- Embeddings on write — every `drive_write` enqueues an embedding via Workers AI `@cf/baai/bge-base-en-v1.5`

**Tier gating.** Free tier: 10K embeddings (covers a few hundred artifacts). Pro: 1M embeddings. Team: 10M. Embeddings are the natural usage meter.

---

## Map of JTBDs → tools → tier

| JTBD | Primary tool(s) | Endpoint(s) | Free | Pro | Team | Business | Enterprise |
|---|---|---|---|---|---|---|---|
| 1 — Cross-agent handoff | `drive_context`, `drive_log_run` | `/v1/context`, `/v1/runs` | ✓ low | ✓ | ✓ | ✓ | ✓ |
| 2 — Audit | `drive_activity`, `/v1/runs` | `/v1/runs`, `/v1/org/timeline` | 30d | 30d | 1yr | 1yr + export | custom |
| 3 — Share with human | `drive_share`, `drive_comment` | `/v1/workspaces/:wid/share` | ✓ | + comment threads | + view audit | + DLP scan | + SSO sharing |
| 4 — BYO-bucket | (UI today; API tomorrow) | `/v1/bucket-config` | ✗ | ✗ | ✓ R2/S3 | ✓ + audit | ✓ + customer keys |
| 5 — Sandbox | `drive_sandbox_*` | `/v1/workspaces/:wid/sandbox` | ✗ | ✓ exp | ✓ | ✓ | ✓ |
| 6 — Memory across sessions | `drive_recall`, `drive_search` | `/v1/search` | 10K embed | 1M | 10M | 50M | custom |

---

## What's NOT a JTBD (and why we should not chase)

- **"Real-time co-editing of a doc with another human."** Not a JTBD users have. `FileCollab` Durable Object is parked.
- **"Pretty WYSIWYG editor for the artifact."** Not a JTBD agents have. Frontend keeps markdown view.
- **"Replace my Notion / Confluence."** Out of scope. AgentDrive is for agent-produced artifacts, not human-authored wikis.
- **"Run my agent for me."** Not an orchestration product. AgentDrive sits beneath orchestrators (LangGraph, CrewAI), it does not replace them.

If a feature request maps to one of these non-JTBDs, route it elsewhere.
