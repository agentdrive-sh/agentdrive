# FLOWS — User flows (tool calls + screens)

**Last updated:** 2026-05-23
**Purpose:** the concrete call sequences that satisfy each JTBD. Each flow names the MCP tools, the REST endpoints, and the frontend screens involved end-to-end.

See [JTBD](./JTBD.md) for the jobs these flows satisfy and [UX](./UX.md) for the screen-by-screen polish priority.

---

## Flow A — Cross-agent handoff (JTBD 1)

**Setup.** Same principal running Claude Code in one terminal and Codex in another. Both have AgentDrive's MCP server wired in via `curl agentdrive.sh/install | sh`.

**Sequence.**

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant AD as AgentDrive Worker
    participant CX as Codex
    participant H as Human (browser)

    CC->>AD: drive_log_run({task: "design auth", artifacts_produced: ["design/auth.md"], status: "complete"})
    AD-->>CC: run_id
    CC->>AD: drive_write({path: "design/auth.md", content: "..."})
    AD-->>CC: file_meta + content_hash
    Note over AD: embedding enqueued via ctx.waitUntil

    Note over CX: next morning, new Codex session
    CX->>AD: drive_context({task: "implement auth", workspace: "myproject", limit: 5})
    AD-->>CX: [design/auth.md + last 3 run summaries]
    CX->>AD: drive_read({path: "design/auth.md"})
    AD-->>CX: content
    CX->>AD: drive_write({path: "src/auth.ts", content: "..."})
    CX->>AD: drive_log_run({task: "implement auth", artifacts_produced: ["src/auth.ts"], status: "complete"})

    H->>AD: open /workspace/myproject
    AD-->>H: WorkspaceView with both agents' activity
```

**Endpoints hit.** `POST /v1/runs`, `POST /v1/workspaces/:wid/files` (write), `POST /v1/context`, `GET /v1/workspaces/:wid/files/:fid` (read).

**Frontend screens involved.** None on the agent side. `WorkspaceView` for the human spot-check.

**Latency target.** `drive_context` round trip < 300ms (R2 + Workers edge + Vectorize).

---

## Flow B — Audit a broken deploy (JTBD 2)

**Setup.** Codex shipped a broken file last night. Production broke. Human opens the dashboard at 9am.

**Sequence.**

```mermaid
sequenceDiagram
    participant H as Human (browser)
    participant AD as AgentDrive Worker
    participant CX as Codex (later)

    H->>AD: GET /dashboard/timeline?agent_platform=codex&since=24h
    AD-->>H: ordered list of runs + writes
    H->>AD: click run_id abc123
    AD-->>H: run detail (task, tool_calls, artifacts)
    H->>AD: click artifact src/auth.ts
    AD-->>H: FileView with version history
    H->>AD: diff v3 vs v4
    AD-->>H: rendered diff
    H->>AD: POST /v1/workspaces/:wid/files/:fid/comments {body: "broken — null check missing on line 42"}
    AD-->>H: comment_id

    Note over CX: next Codex session
    CX->>AD: drive_feedback({path: "src/auth.ts"})
    AD-->>CX: human comment
    CX->>AD: drive_write({path: "src/auth.ts", content: "..."}) (patched)
    CX->>AD: drive_log_run({task: "fix broken auth", status: "complete"})
```

**Endpoints hit.** `GET /v1/org/timeline`, `GET /v1/runs/:run_id`, `GET /v1/workspaces/:wid/files/:fid/versions`, `POST /v1/workspaces/:wid/files/:fid/comments`, `GET` of same.

**Frontend screens involved.** `DashboardPage` (timeline filter UI), `FileView` (diff), comment sidebar.

**Polish gap.** Version diff renderer is currently functional but not slick — [UX.md](./UX.md) flags as Low priority for $10K MRR.

---

## Flow C — BYO-bucket onboarding (JTBD 4)

**Setup.** Team customer upgraded. Wants artifact content on their own AWS S3 bucket in `eu-west-1` for GDPR.

**Sequence.**

```mermaid
sequenceDiagram
    participant H as Human (admin)
    participant AD as AgentDrive Worker
    participant S3 as Customer S3
    participant AG as Any agent

    H->>AD: GET /billing → upgrade to Team
    AD-->>H: Stripe checkout → success
    H->>AD: GET /settings/bucket-config (UI: NOT BUILT YET)
    Note over H: today: API only via curl
    H->>AD: POST /v1/bucket-config {provider: "s3", access_key_id, secret_access_key, region, bucket}
    AD->>S3: HEAD s3://bucket — health check
    S3-->>AD: 200 OK
    AD-->>H: {status: "active", bucket_id}

    AG->>AD: drive_write({path: "report.md", content: "..."})
    AD->>S3: PUT s3://bucket/content/<sha256>
    S3-->>AD: 200
    AD-->>AG: file_meta (with storage_locator pointing at S3)

    Note over AG,S3: future drive_read routes to S3 per locator
    AG->>AD: drive_read({path: "report.md"})
    AD->>S3: GET s3://bucket/content/<sha256>
    S3-->>AD: content
    AD-->>AG: content

    Note over AD: if write fails 3x consecutively
    AD->>AD: bucket-health auto-degrade → status: "read_only"
    Note over H: dashboard surfaces /verify recovery banner
```

**Endpoints hit.** `POST/GET/PATCH /v1/bucket-config`, `POST /v1/bucket-config/:id/verify`, all normal file write/read paths (which honor the recorded `storage_locator` on `FileMeta`).

**Frontend screens involved.** `BillingPage`, **missing `BucketConfigPage`** (build-priority — see [UX.md](./UX.md)), banner on `DashboardPage` for degraded buckets.

**Latency target.** Configuration round-trip < 3s (one HEAD request to customer's S3 for health check). Steady-state writes match R2 latency within ~20ms (S3 region-pinned, slower than R2 edge).

---

## Flow D — Share an artifact with a human (JTBD 3)

**Setup.** Agent finished a customer report. Founder wants to send it to the customer for review.

**Sequence.**

```mermaid
sequenceDiagram
    participant A as Agent
    participant AD as AgentDrive Worker
    participant H as Founder
    participant C as Customer (recipient)

    A->>AD: drive_share({path: "reports/acme-q2.md", email: "ceo@acme.com", max_uses: 5, expires_in: "7d"})
    AD-->>A: share_url (HMAC token in URL)
    A->>H: returns link in chat
    H->>C: pastes link in email
    C->>AD: GET /share/<token>
    AD->>AD: verify HMAC, check email gate, check max_uses + expiry
    AD-->>C: TokenResolver page → preview → access
    C->>AD: GET /v1/share/<token>/file
    AD-->>C: content + comment thread
    C->>AD: POST /v1/share/<token>/comments {body: "looks good, ship it"}
    AD-->>C: comment_id

    Note over A: next session
    A->>AD: drive_feedback({path: "reports/acme-q2.md"})
    AD-->>A: customer comment
```

**Endpoints hit.** `POST /v1/workspaces/:wid/share`, `GET /share/:token`, `GET /v1/token-info`, `GET /v1/share/:token/file`, `POST /v1/share/:token/comments`.

**Frontend screens involved.** `TokenResolver` (public, no auth), comment sidebar.

**Security note.** HMAC uses `TOKEN_SIGNING_SECRET`. Token includes `tid` so revocation is via `KV token:<tid>` lookup. Max-uses tracked in same record.

---

## Flow E — Memory across sessions (JTBD 6)

**Setup.** User told Claude Code last Tuesday "we decided to use Postgres not MongoDB for this project." Today, Codex is asking what database to scaffold.

**Sequence.**

```mermaid
sequenceDiagram
    participant CC as Claude Code (last Tue)
    participant AD as AgentDrive Worker
    participant CX as Codex (today)

    CC->>AD: drive_write({path: "decisions/database.md", content: "Decided Postgres over MongoDB because..."})
    AD-->>CC: ok (embedding enqueued)

    Note over CX: today, new Codex session
    CX->>AD: drive_recall({query: "what database did we decide on?", workspace: "myproject"})
    AD->>AD: queryEmbeddings against Vectorize (filter: workspace + kind=decision)
    AD-->>CX: [decisions/database.md snippet] + score 0.91

    CX->>AD: drive_search({q: "postgres", workspace: "myproject"})
    AD-->>CX: more context

    Note over CX: scaffolds Postgres, not MongoDB
```

**Endpoints hit.** `POST /v1/search`, semantic search via Vectorize, optional keyword fallback if embeddings fail.

**Embedding pipeline.** Every `drive_write` enqueues via `ctx.waitUntil` to embed via Workers AI `@cf/baai/bge-base-en-v1.5` (768-dim). 16-chunk cap × 1500-char windows. Idempotent (content-addressed).

**Failure modes.** Workers AI rate limit → falls back to OpenAI `text-embedding-3-small` via AI Gateway. Embedding never blocks the write (graceful degradation).

---

## Flow F — Sandbox agent execution (JTBD 5, experimental)

**Setup.** Agent needs to run a test suite against a checked-out repo. Per-workspace isolation required.

**Sequence.**

```mermaid
sequenceDiagram
    participant A as Agent
    participant AD as AgentDrive Worker
    participant SB as Sandbox (Cloudflare Container)
    participant CONT as CONTENT (R2)

    A->>AD: drive_sandbox_clone({repo: "github.com/x/y", branch: "main"})
    AD->>SB: provision per-workspace container
    SB->>SB: git clone
    SB-->>AD: cloned (path)
    AD-->>A: ok

    A->>AD: drive_sandbox_exec({command: "pnpm install && pnpm test"})
    AD->>SB: run command
    SB-->>AD: stdout + stderr + exit_code
    AD-->>A: result

    A->>AD: drive_sandbox_read({path: "test-results.json"})
    AD->>SB: read file
    SB-->>AD: content
    AD-->>A: content

    A->>AD: drive_sandbox_commit({message: "Test run 2026-05-23"})
    AD->>SB: git add + commit
    AD->>CONT: persist as artifact (workspace/sandbox/commit-<sha>.tar)
    CONT-->>AD: ok
    AD-->>A: artifact_id
```

**Endpoints hit.** `/v1/workspaces/:wid/sandbox/clone`, `/exec`, `/read`, `/commit`.

**Failure mode (graceful).** If `SANDBOX` binding is absent in the worker config (most users — Cloudflare Containers requires a separate plan), all sandbox endpoints return 503 with `{error: "sandbox not configured"}`. The rest of the product works fine.

**Status.** Phase 5, experimental. Not the v1 marketing headline.

---

## Cross-flow patterns

### Authentication pattern (all flows)
Every authenticated request carries:
- `Authorization: Bearer agentdrive_live_<key>` (resolves to principal via `api_key:<sha256(key)>` KV lookup)
- `X-Agent-Platform: claude-code | codex | cursor | langgraph | crewai | autogen | mcp | unknown`
- `X-Agent-Role: <free-form, ≤64 chars>` (optional)

The principal + platform + role together populate provenance on every artifact and run.

### Embedding pattern (Flows A, E)
Embeddings are fire-and-forget via `ctx.waitUntil`. Never block a write. Failures log and degrade gracefully — search still works via keyword fallback.

### Bucket-routing pattern (Flow C, downstream of Flow A and E)
Once a workspace has a `bucket_config` set, all writes route to the configured bucket. The `storage_locator` is recorded on `FileMeta`, so future reads route back to the same place even if the workspace's default bucket changes later.

### Cursor pagination (every list endpoint)
KV list operations are cursor-paginated. Default page size 50, max 1000. Response shape `{data: T[], cursor: string | null}`. Never hardcode `limit: 100` (Wave 1 fix).
