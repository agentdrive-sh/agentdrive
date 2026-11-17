# JOURNEY — User journey by ICP segment

**Last updated:** 2026-05-23
**Purpose:** the journey each ICP segment takes, with friction points and intervention opportunities named.

See [ICP](./ICP.md) for who these journeys belong to, [FLOWS](./FLOWS.md) for the call sequences within them, and [UX](./UX.md) for the screen polish priorities derived from this doc.

Each journey is broken into five phases: Discover → Install → First Value → Daily Use → Pay. Phases are not strictly sequential — daily use can precede pay by weeks.

---

## Segment 1 — Indie multi-agent developer

### Discover
**Where they hear about us.**
- Search Smithery / Glama / mcp.so for "agent memory" or "cross-platform" or "workspace"
- HN front page on Show HN day
- Twitter/X — founder's network, AI dev Twitter (Hamel, Eugene, Simon)
- A friend installed and mentioned it in a Discord
- Anthropic skills marketplace (planned distribution)

**Friction.**
- 17K+ MCP servers in the wild — discoverability is the actual problem now, not presence
- "Memory layer" is the saturated keyword owned by Mem0; we ride a different keyword (workspace, cross-platform, provenance)

**Intervention.**
- Show HN with concrete cross-agent demo (not feature list)
- One-paragraph repo description that names Claude Code + Codex + Cursor by name
- "Verified/safe MCP" positioning (1/3 of MCP servers indexed have SSRF vulns per Q1 2026 scan)

### Install
**Path.** `curl -fsSL agentdrive.sh/install | sh` → detects installed agent tools → writes MCP config to each → prompts for magic-link email.

**Time-to-first-MCP-call.** Target <2 minutes (install + magic-link + first `drive_write` in Claude Code).

**Friction inventory (current product surface):**
- Magic-link email round-trip adds 30–60s, breaks the install flow if the email is slow
- No Google/GitHub OAuth on `LoginPage` — magic-link only
- Install script detection of Cursor/Cline/Continue/Zed varies in completeness across OSes

**Intervention (Pre-$10K MRR):**
- Add Google/GitHub OAuth to `LoginPage` (already supported in `/auth/oauth` backend — just needs frontend wiring)
- `curl | sh` should print a clear "next step" instruction with example MCP tool call

### First value
**The "aha" moment.** First cross-agent handoff. Specifically: they start a task in Claude Code, log a run, then in a fresh Codex session, `drive_context` returns the design they wrote 10 minutes ago.

**Time-to-first-value.** Target <10 minutes from install. For most users, this lines up with the next session, which is the next morning.

**Friction.**
- They install on day 1 but don't trigger cross-agent handoff until day 3–7
- `drive_context` is not auto-invoked — agent has to know to call it. Without a skill file or system prompt nudge, the value never materializes.

**Intervention.**
- Skill file at `~/.claude/skills/agentdrive/` that nudges Claude Code to call `drive_context` at session start
- Codex/Cursor equivalents (CLAUDE.md-style instructions injected by the installer)

### Daily use
**Tools called most often (in priority).**
1. `drive_context` — at session start
2. `drive_write` — every artifact produced
3. `drive_log_run` — at session end
4. `drive_search` / `drive_recall` — on demand when looking up something

**Friction.**
- Free quota: 10K embeddings = a few hundred artifacts. Power users hit this in 2–4 weeks.
- 3-agent cap on Free tier — users with Claude Code + Codex + Cursor + LangGraph already hit this immediately

**Intervention.**
- Quota-hit dashboard banner with one-click upgrade CTA (quota enforcement is parked today; turn on at 10 paid users)
- Email nudge at 80% free quota consumption

### Pay
**Trigger events for Pro upgrade.**
- Hit 80%+ of embedding quota
- Hit 3-agent cap (most common)
- Want 30-day run log retention (default for Pro)

**Friction.**
- BillingPage currently functional but doesn't reflect refreshed pricing tiers
- No clear "compare plans" visual

**Conversion rate target.** 3% free→Pro for the wedge — see [MRR-PLAN](./MRR-PLAN.md).

---

## Segment 2 — AI-native Series A team

### Discover
**Where they hear about us.**
- A co-founder installs as Segment 1 → tells the team
- MCP marketplace listings (same as Segment 1)
- AI eng Twitter — Hamel, Eugene Yan, Simon Willison-adjacent feedback
- Cloudflare partner directory (planned)
- Supermemory-style angel network (Jeff Dean, Dane Knecht, Logan Kilpatrick, David Cramer) — once we get one Segment 2 customer, the YC/a16z network kicks in

**Intervention.**
- Explicit referral ask in Pro→Team upgrade flow ("which other AI-native team should we talk to?")
- Case study from the first 2–3 Segment 2 customers

### Install
**Path.** Co-founder installs as Pro → triggers Team upgrade → admin adds 4 teammates via `/v1/workspaces/:wid/roles`.

**Time-to-first-team-call.** Target <1 hour from upgrade. Each teammate needs their own magic-link login + skill file install.

**Friction.**
- No bulk-invite UI for adding teammates
- Magic-link onboarding doesn't scale for a team that wants SSO

**Intervention.**
- Bulk invite via CSV or comma-separated emails on `DashboardPage`
- Stub SSO/SAML toggle on Team tier with "configure in Business tier" CTA

### First value
**The "aha" moment.** First time two teammates each have their agent reading from a shared workspace. Or: BYO-bucket onboarding completes and writes start landing in their AWS account.

**Friction.**
- `BucketConfigPage` does not exist yet — requires API call to configure BYO-bucket
- No team-wide audit log view in v1

**Intervention (build-priority for $10K MRR).**
- Build `BucketConfigPage` with credential entry + health check + verify flow
- Add team-wide timeline filter to `/dashboard/timeline`

### Daily use
**Patterns.**
- 5–10 principals each calling drive tools 50–200 times/day
- Heavy use of `drive_log_run` for production agent post-mortems
- Periodic `drive_share` for sending artifacts to design/PM/customer

**Friction.**
- Quota tracked but not enforced — Segment 2 customers won't trust a billing system that doesn't show real usage
- No per-agent usage breakdown — they want to know which agent (Claude/Codex/Cursor) is consuming the most embeddings

**Intervention.**
- Quota enforcement post-10-paid-users, with per-principal usage chart on `BillingPage`
- Per-agent_platform breakdown on `/dashboard/timeline`

### Pay
**Trigger events for Team → Business upgrade.**
- Compliance asks for audit log retention >30 days
- SSO requirement from IT
- Need >5 seats (the Team cap)

**Friction.**
- SOC2 not yet certified — blocks some Business conversations until it ships (v1.5 roadmap kickoff)
- Business tier is new (per refreshed [MONETIZATION](./MONETIZATION.md)) — pricing needs validation with first 3–5 customers

---

## Segment 3 — Enterprise data-residency buyer

### Discover
**Where they hear about us.**
- Referral from Segment 2 customer ("our agent infra runs on AgentDrive on our own AWS")
- Direct outbound — only after a clear ICP signal (LinkedIn job posting for "AI Platform Engineer" + open agent initiative)
- Industry analyst placement — out of reach in v1, attainable by v2

**Friction.**
- Brand recognition: AgentDrive is a startup most CISOs have never heard of
- No Gartner / Forrester coverage

**Intervention.**
- Land 2–3 named Segment 2 customers and use them as references
- File for AWS Marketplace listing (BYO-bucket on AWS is the natural shape)

### Install
**Path.** Multi-stage:
1. NDA + security questionnaire (1–2 weeks)
2. Pilot with isolated workspace on customer AWS account (2–4 weeks)
3. Production rollout with SOC2 attestation + custom MSA (4–8 weeks)

**Time-to-first-production-call.** 2–6 months end-to-end.

**Friction.**
- SOC2 Type 2 mandatory for many enterprises — v1.5+ deliverable
- BYO-bucket UX is API-only today — need a guided onboarding flow

**Intervention.**
- SOC2 Type 1 by month 6 post-launch (using Vanta or Drata, ~$15K cost, 6-month timeline solo)
- White-glove onboarding script — the founder runs the first 3 enterprise installs personally

### First value
**The "aha" moment.** Their first production agent run writes to their own S3 bucket, with their CMK, audit log going to their CloudWatch. Compliance officer signs off.

**Friction.**
- Customer-managed keys not yet supported (v1.5+)
- Custom audit log export format may not match their SIEM

### Daily use
- Single-digit principals (their AI Platform Engineering team)
- High value per call — production agent infrastructure
- Strict SLA expectations once paid

### Pay
**Pricing.** $2K–$10K/mo, annual commit, custom MSA.

**Trigger to close.**
- Pilot success criteria met (defined upfront)
- Procurement clears the security questionnaire
- Renewal of an internal "we'll build it ourselves" project gets killed in favor of buying

---

## Cross-segment friction inventory (priority-ordered for $10K MRR)

| Friction | Affects | Priority | Intervention |
|---|---|---|---|
| Magic-link only login | All segments, especially Seg 2 onboarding | **High** | Wire Google/GitHub OAuth on `LoginPage` (backend exists) |
| `BucketConfigPage` missing | Seg 2 + Seg 3 | **High** | Build the UI; API is shipped |
| Quota not enforced | Seg 1 Pro upgrades, Seg 2 trust | **High** | Turn on enforcement after 10 paid customers |
| Refreshed pricing not in `BillingPage` | All paying segments | **High** | Update Stripe products + frontend tier display |
| Skill file not auto-installed | Seg 1 time-to-value | Medium | Bundle skill file in `curl | sh` install |
| No bulk team invite | Seg 2 onboarding | Medium | Add to `DashboardPage` |
| No per-agent usage breakdown | Seg 2 trust | Medium | Add filter to `/dashboard/timeline` |
| No SSO/SAML | Seg 2 → Business, Seg 3 | Low for $10K MRR, **High for $100K MRR** | Stub on Team tier, build on Business tier |
| No SOC2 | Seg 3 entirely, some Seg 2 | Low for $10K MRR, **Required for $100K MRR** | Kickoff at $40K MRR per [MONETIZATION](./MONETIZATION.md) |

The High-priority items are the punchlist for getting from current state to $10K MRR. Everything Medium and Low waits.

---

## Drop-off model (estimated, to be validated with real funnel data)

Wedge funnel (per `MRR-PLAN.md`):

```
1,000 GitHub stars / Show HN viewers
    ↓ 30% click through to landing page
300 landing page visitors
    ↓ 50% run the install command
150 successful installs (Gate 1 if hit 10 in first 14 days)
    ↓ 60% perform a first cross-agent handoff in week 1
90 active free users (Gate 2 if 5 workspaces with cross-platform activity)
    ↓ 70% return for week 2
63 returning free users (Gate 3 if 3 returning in 14 days)
    ↓ 5% upgrade to Pro at some point in next 90 days
3 Pro subscribers per 1,000 top-of-funnel
```

To hit 50 Pro subscribers, need ~17,000 top-of-funnel touches over 6 months. ~700/week sustained. Achievable via Show HN (one-shot ~5K), MCP marketplace listings (200/week steady-state), Twitter (100/week), Cloudflare/Anthropic partner programs (intermittent spikes).

This model is **a hypothesis**. Real conversion rates are measured post-launch via [METRICS](./METRICS.md).
