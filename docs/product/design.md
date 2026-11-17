# UX — Screens, polish priority, missing surfaces

**Last updated:** 2026-05-23
**Purpose:** map every frontend screen to its role in the user journey and rank polish priority against the $10K MRR target.

See [JOURNEY](./JOURNEY.md) for the friction inventory this priority list comes from, [FLOWS](./FLOWS.md) for the sequences each screen participates in, and [ICP](./ICP.md) for who lives in each screen.

Source of truth for screens that exist: `apps/frontend/src/pages/`. Source of truth for endpoints they call: `apps/worker/src/`.

---

## Inventory of existing screens

| Screen | File | Role in journey | Polish priority for $10K MRR |
|---|---|---|---|
| `LandingPage` | `apps/frontend/src/pages/LandingPage.tsx` | Discover → Install | **High** |
| `LoginPage` | `apps/frontend/src/pages/LoginPage.tsx` | Install → First Value | **High** |
| `CliAuthPage` | `apps/frontend/src/pages/CliAuthPage.tsx` | Install (CLI polling) | Medium |
| `AuthCallbackPage` | `apps/frontend/src/pages/AuthCallbackPage.tsx` | OAuth handler | Low |
| `DashboardPage` | `apps/frontend/src/pages/DashboardPage.tsx` | First Value → Daily Use | Medium |
| `WorkspaceView` | `apps/frontend/src/pages/WorkspaceView.tsx` | Daily Use | Low |
| `FileView` | `apps/frontend/src/pages/FileView.tsx` | Daily Use → Pay (audit JTBD) | Low |
| `BillingPage` | `apps/frontend/src/pages/BillingPage.tsx` | Pay | **High** |
| `TokenResolver` | `apps/frontend/src/pages/TokenResolver.tsx` | Discover (incoming share link) | Medium |
| _(missing)_ `BucketConfigPage` | — | Pay (BYO-bucket JTBD) | **High — build** |
| _(missing)_ `TeamSettings` | — | Pay (Team tier onboarding) | Medium — build |

---

## Per-screen detail

### LandingPage — High polish priority

**Current state.** Hero with locked one-liner, install command, platform list, two CTAs (GitHub, Docs). Dense and developer-direct. Currently good but reflects pre-Cloudflare-Agent-Memory positioning.

**Changes needed before $10K MRR:**
1. **Update one-liner** to the refreshed positioning (workspace + provenance + portable) — see [POSITIONING](./POSITIONING.md) for the locked text.
2. **Add a "Bring your own bucket" callout** below the install command. This is the moat against Cloudflare Agent Memory; surface it.
3. **Add a 30-second demo clip** (cross-agent handoff in real time). Static text doesn't convert as well as showing the flow.
4. **Add a "What's different" section** with a 3-row comparison: AgentDrive vs Mem0 vs Anthropic Memory Tool. Honest, not snarky.
5. **Keep platform pills** but add Anthropic Claude Code skill marketplace badge once submitted.

**Endpoints called.** None — static page. Install command points at `agentdrive.sh/install`.

### LoginPage — High polish priority

**Current state.** Magic-link entry. Backend supports OAuth via `/auth/oauth` but frontend doesn't wire it.

**Changes needed:**
1. **Add Google + GitHub buttons as primary CTAs**, with magic-link as secondary. OAuth is 1-click vs 30–60s magic-link.
2. Inline error states for "email not allowed" / "rate limited" / "code expired."
3. Stable 8-char OTP support (already on backend) for users who lose the magic link.

**Endpoints called.** `POST /v1/auth/send-code`, `POST /v1/auth/verify-code`, `GET /auth/oauth/google`, `GET /auth/oauth/github`.

### BillingPage — High polish priority

**Current state.** Stripe checkout works. Plan listing reflects old $20 Pro / $99 Team / Enterprise tiering.

**Changes needed:**
1. **Update plan cards** to the refreshed tiers from [MONETIZATION](./MONETIZATION.md): Free / Pro $29 / Team $149 / Business $499 / Enterprise.
2. **Add tier comparison table** with the JTBD → tier mapping from [JTBD.md](./JTBD.md).
3. **Show current usage vs quota** prominently — embeddings used, R2 storage, agents registered, runs logged.
4. **Show "What unlocks at next tier"** — specifically BYO-bucket on Team, SSO on Business.
5. **Stripe product IDs** need to be re-created in Stripe dashboard to match new pricing.

**Endpoints called.** `GET /v1/billing`, `POST /v1/billing/checkout`, `GET /v1/org` (for usage display).

### BucketConfigPage — High build priority (does not exist)

**Why it matters.** BYO-bucket is the Team-tier wedge feature and the moat against Cloudflare Agent Memory. Today it's API-only — Segment 2 customers have to `curl` to configure. That's the wrong friction surface for a $149/mo product.

**Build spec:**
1. Route: `/settings/bucket-config` (Team tier and above only)
2. Form: provider selector (R2 default / Cloudflare R2 cross-account / S3-HMAC; future GCS, Azure)
3. Credential entry — masked fields per the secret-masking contract (GET never returns `secret_access_key`)
4. "Test connection" button → `POST /v1/bucket-config/:id/verify`
5. Health status indicator (active / read-only / failed)
6. List of workspaces using this bucket
7. Auto-degrade banner when bucket-health degrades (shipped 2026-05-22)

**Endpoints called.** `POST/GET/PATCH /v1/bucket-config`, `POST /v1/bucket-config/:id/verify`.

**Estimated effort.** 1–2 days frontend + design. Backend complete.

### CliAuthPage — Medium polish

**Current state.** Polling for CLI auth completion. Functional, basic styling.

**Changes:**
- Add progress indicators (waiting / connected / ready)
- Add fallback "copy this code into your terminal" path if browser polling fails

### DashboardPage — Medium polish

**Current state.** Workspace list + recent files. Decent for solo use.

**Changes:**
1. Empty-state with "Try this" cards (write a file via CLI, install MCP skill, share a file)
2. Per-agent_platform filter on the activity timeline (Segment 2 ask)
3. Bulk team invite UI (Segment 2 ask — see [JOURNEY](./JOURNEY.md))
4. Banner for bucket-health degraded state

### WorkspaceView — Low polish (functional)

**Current state.** File tree + recent activity. Works.

**Changes (optional for $10K MRR):**
- Better breadcrumbs
- Filter files by `agent_platform` that wrote them

### FileView — Low polish

**Current state.** File content + comment sidebar + version list.

**Changes (optional):**
- Slicker version diff renderer
- Inline run-id link (which agent run produced this version)

### TokenResolver — Medium polish

**Current state.** Public token preview + access page. Works.

**Why it matters.** This is the first impression for any human who clicks a share link from someone using AgentDrive. Conversion surface, even though it's not transactional.

**Changes:**
- Footer: "AgentDrive — shared workspace for AI agents" with link to landing page
- Honor email-gate cleanly with a "sign in to verify" UX

### AuthCallbackPage — Low polish

Generic OAuth callback. No changes needed.

### TeamSettings — Medium build priority (does not exist)

**Why it matters.** Team tier customers expect a settings surface. Today they manage roles via `/v1/workspaces/:wid/roles` API.

**Build spec:**
1. Route: `/settings/team` (Team tier and above only)
2. List principals in org with role + last active
3. Invite (single email or bulk CSV)
4. Per-workspace role assignment
5. Future: SSO/SAML toggle stub (Business tier link)

**Build after BucketConfigPage.** Lower priority because BYO-bucket is the higher-leverage tier feature.

---

## Polish priority ranked by MRR impact

These are the 5 highest-leverage screen changes for moving from current state to $10K MRR. Order is impact-per-effort, not absolute priority.

1. **BillingPage refresh** to new pricing (1 day) — required for any Stripe go-live
2. **BucketConfigPage build** (1–2 days) — unlocks Team conversions stuck on BYO-bucket
3. **LandingPage refresh** with new one-liner + BYO-bucket callout + demo clip (1 day)
4. **LoginPage OAuth wiring** (half-day) — reduces install-funnel drop-off
5. **DashboardPage empty-state + per-platform filter** (half-day) — improves first-week retention

Estimated total: ~5 days of focused frontend work. Single-developer scope.

---

## Things explicitly NOT to polish

- Color palette / typography — stays as-is (zinc-950 + emerald-500 works)
- Real-time collaboration — `FileCollab` Durable Object remains parked
- Mobile responsiveness — agent developers don't manage on mobile
- WYSIWYG markdown editor — code-mirror or plain text is fine
- Settings → notifications page — defer
- Per-file permissions UI — workspace-level roles are sufficient for v1

---

## Where the design system lives

- Frontend: React 19 + Vite 7 + TailwindCSS + React Router
- Design tokens: implicit in Tailwind (`zinc-950` for bg, `emerald-500` for accent, `zinc-300/400/500` for text levels)
- No formal design system doc; copy verbatim from existing screens for consistency
- Component library: none externally; minimal handrolled

Drift-detection rule for any new screen: must use `bg-zinc-950 text-white` as page shell, `border-zinc-800` for separators, `emerald-500` for primary CTAs. No new color introductions without revising the locked palette.
