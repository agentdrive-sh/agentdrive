# Architecture Decision Records

This directory records the load-bearing decisions behind AgentDrive. Each ADR explains the context that forced a choice, the choice itself, the consequences (good and bad), and the alternatives that were rejected. They are not changelogs; they are the *reasons* a future reader needs to understand the code.

Read these before proposing a structural change. Most of these decisions are reversible at a cost — the ADR exists so the cost is paid knowingly.

## Index

| # | Title | Status |
|---|---|---|
| [0001](./0001-kv-and-r2-as-storage-substrate.md) | KV + R2 as the storage substrate | Accepted |
| [0002](./0002-hono-on-cloudflare-workers.md) | Hono on Cloudflare Workers as the API runtime | Accepted |
| [0003](./0003-mcp-first-integration-surface.md) | MCP as the first-class integration surface | Accepted |
| [0004](./0004-split-license-bsl-apache.md) | Split licensing — BSL-1.1 for the host, Apache-2.0 for the SDK surface | Superseded by 0009 |
| [0005](./0005-bucket-driver-byo-bucket.md) | BucketDriver indirection for BYO-bucket | Accepted |
| [0006](./0006-envelope-encryption-versioned-kek.md) | Envelope encryption with versioned KEK | Accepted |
| [0007](./0007-cross-agent-identity-principal-plus-platform.md) | Cross-agent identity — one principal, per-request platform header | Accepted |
| [0008](./0008-content-addressed-storage.md) | Content-addressed storage with sha256 dedup | Accepted |
| [0009](./0009-agpl-server-license.md) | AGPL-3.0 for the server, Apache-2.0 for the clients | Accepted |

## Format

Each ADR follows the structure:

- **Status** — Proposed / Accepted / Superseded / Deprecated, plus the date of the last status change.
- **Context** — what was happening that forced the decision.
- **Decision** — the choice, stated as a present-tense fact.
- **Consequences** — what becomes easier, harder, or different because of the decision.
- **Alternatives considered** — what was on the table and why each was rejected.
- **References** — code, related ADRs, strategy docs.

## When to add an ADR

Add one when:

- A reversible-but-expensive choice is being locked in (storage tech, protocol, license terms, identity model).
- A new contributor would reasonably ask "why isn't this done the obvious way?"
- A constraint is being introduced that future code must respect (e.g. "never derive blob keys from the share-token secret").

Do **not** add one for:

- Style preferences (those live in `CLAUDE.md`).
- Roadmap items (those live in `docs/product/roadmap.md`).
- Bug fixes or refactors that don't change a structural assumption.

## When to supersede

When a decision changes, write a new ADR that names the one it replaces. Mark the old one `Superseded by [NNNN]` in its status line. Do not edit the body of a superseded ADR — the historical reasoning matters.
