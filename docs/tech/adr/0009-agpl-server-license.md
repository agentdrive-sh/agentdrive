# ADR-0009: AGPL-3.0 for the server, Apache-2.0 for the clients

**Status:** Accepted — 2026-11-17. Supersedes [ADR-0004](./0004-split-license-bsl-apache.md).

## Context

ADR-0004 licensed the hosted code (`apps/worker`, `apps/web`, `apps/frontend`) under the Business Source License 1.1 with a 2029 conversion to Apache-2.0, and the client surface under Apache-2.0. The goal was to block a competing hosted fork while keeping client adoption friction-free.

AgentDrive is now being published as an open-source monorepo. BSL-1.1 is not an OSI-approved license, so "open source" would not hold for the server. Developer audiences treat source-available licenses as a reason not to adopt or contribute. Self-hosting on your own Cloudflare account is also becoming a supported path, and BSL's use restrictions make that path harder to explain.

The original concerns still stand: a closed hosted fork of the server should not be possible, and the clients must stay embeddable in any codebase. ADR-0004 rejected AGPL because corporate legal teams refuse a transitive AGPL dependency. That objection applies to code that is linked or vendored. The clients talk to the server only over HTTP and MCP; they never import server code.

## Decision

**GNU AGPL v3 (`AGPL-3.0-only`)** for the server: `apps/worker`, `apps/web`, `apps/frontend`. The root `LICENSE` is the AGPL-3.0 text and covers any path without a more specific `LICENSE`.

**Apache-2.0** stays on everything a user installs, imports or vendors: `packages/cli`, `packages/mcp-server`, `packages/sdk-ts`, `packages/shared`, `apps/installer`, `apps/docs`, and the Claude Code plugin.

Contributors sign a **Contributor License Agreement** (`CLA.md`) that grants Roushan Inc a broad copyright and patent license, including the right to sublicense and relicense. Contributors keep their copyright. This lets Roushan Inc sell a **commercial license** to organizations that cannot use AGPL software.

The name and logo are covered separately by `TRADEMARKS.md`: forks must rebrand.

`LICENSING.md` documents the split in user-facing terms.

## Consequences

**Easier:**

- The server is OSI-approved open source. Anyone can self-host, audit and modify it.
- A hosted fork must publish its modified source to its users (AGPL section 13), so a closed managed-service fork is not possible.
- No conversion date to track. ADR-0004's 2029 change-date mechanics go away.
- Client adoption is unchanged: the Apache-2.0 packages carry no copyleft, and calling an AGPL server over the network does not extend the AGPL to the caller.

**Harder:**

- Some companies ban AGPL software outright, even for internal self-hosting. The commercial license and the hosted service are the answer for them.
- Every external contribution needs a signed CLA before merge, which adds a step for first-time contributors. A bot (`.github/workflows/cla.yml`) handles it on the pull request.
- Two licenses to maintain, as before. A file that lands in the wrong package inherits the wrong license.
- A permissive fork of the server is no longer possible for third parties without a commercial license.

**Trigger to revisit:**

- If AGPL measurably blocks adoption of the self-hosted server by the teams AgentDrive targets, consider relicensing the server more permissively. The CLA keeps that option open.

## Alternatives considered

- **Keep BSL-1.1.** Protects against a hosted fork but is not open source, which is the point of the release.
- **Apache-2.0 or MIT across the whole repo.** Maximum adoption, but a cloud provider could run a closed hosted fork.
- **SSPL.** Stronger service clause than AGPL, but not OSI-approved and widely rejected by the same audience BSL loses.
- **AGPL without a CLA.** Simpler for contributors, but every outside contribution would be AGPL-only, which removes the commercial-license option and any future relicensing.

## References

- `LICENSE` (root) and `apps/worker/LICENSE`, `apps/web/LICENSE`, `apps/frontend/LICENSE` — AGPL-3.0 text.
- `LICENSING.md` — user-facing explanation of the split.
- `CLA.md`, `TRADEMARKS.md`, `CONTRIBUTING.md`.
- ADR-0003 — the client surface that the Apache-2.0 grant covers.
- ADR-0004 — the superseded BSL decision.
