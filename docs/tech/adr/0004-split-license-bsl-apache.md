# ADR-0004: Split licensing — BSL-1.1 for the host, Apache-2.0 for the SDK surface

**Status:** Superseded by [0009](./0009-agpl-server-license.md) — 2026-11-17

## Context

AgentDrive is commercially monetized via the hosted service at `app.agentdrive.sh` and the planned Enterprise tier (BYO-bucket on customer cloud, SOC2, SLA). At the same time, distribution depends on agents, IDEs, and SDKs being able to integrate without legal friction — anything with even a hint of GPL-style reciprocity gets cut from corporate procurement.

A single permissive license (MIT / Apache-2.0 across the whole repo) protects the SDK distribution path but invites a cloud-provider to fork the worker and resell it as a managed service. A single restrictive license (BSL-1.1, SSPL, Commons Clause across the whole repo) deters the fork but blocks SDK adoption inside corporate codebases.

## Decision

**Apache-2.0** for everything an agent host or customer would import or vendor: `packages/mcp-server`, `packages/cli`, `packages/sdk-ts`, `packages/shared`, `apps/installer`.

**Business Source License 1.1 (BSL-1.1)** for the hosted code: `apps/worker`, `apps/web`, `apps/frontend`, `apps/docs`. The BSL prohibits offering a hosted/managed AgentDrive service competing with `app.agentdrive.sh`. It does not prohibit running the code yourself for non-competing internal use.

The BSL **change date is 2029-05-15** (three years from the v0 license date). On that date, every BSL-1.1 file in the repo at the change-date commit auto-converts to **Apache-2.0**. This is a one-time, automatic conversion baked into the license text.

A `LICENSE` file at the repo root and per-package `LICENSE` files make the boundary explicit. `LICENSING.md` documents the split in user-facing terms.

## Consequences

**Easier:**

- Corporate adoption of the SDK + CLI + MCP server is friction-free.
- The hosted product has legal protection against a managed-service fork.
- The 2029 conversion is a credible signal: AgentDrive is not betting on perpetual closed-source moat. The bet is on three years of head start.

**Harder:**

- Two licenses to maintain. Every new file has to land in the correct package and inherit the right license; a misplaced file is a license bug.
- BSL is non-OSI-approved. Some enterprises forbid BSL deps even for internal use; the SDK path is the workaround.
- We can't accept BSL contributions back from a downstream that modified the worker — they don't gain the BSL grant unless they sign a CLA. v1 has no CLA.

**Trigger to revisit:**

- If BSL friction starts blocking real Enterprise deals (Segment 3 buyer cites it as a no-go), shorten the change date or move to a Commons Clause variant.
- If the 2029 conversion is approaching and we still have meaningful proprietary advantage, we can extend the change date for new commits only — never retroactively. Once a commit is dated and shipped under BSL-1.1, it converts on the original date.

## Alternatives considered

- **Apache-2.0 across the whole repo.** Maximum permissive; gives up the fork-protection.
- **MIT across the whole repo.** Same trade-off, slightly weaker patent grant than Apache-2.0.
- **AGPLv3 for the worker.** Strong copyleft, but blocks the SDK path because corp legal will refuse a transitive AGPL dep even when the SDK itself is permissive.
- **SSPL.** Same intent as BSL but with a "service-source-public" requirement that's broader than we need.
- **Source-available with no conversion date.** The 2029 conversion is what keeps this honest — the alternative is "trust us, we'll open-source it someday."

## References

- `LICENSE` (root) — BSL-1.1 text.
- `LICENSING.md` — user-facing explanation of the split.
- Per-package `LICENSE` files in `packages/*/LICENSE` and `apps/*/LICENSE`.
- ADR-0003 — the SDK surface that the Apache-2.0 grant covers.
