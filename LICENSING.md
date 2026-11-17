# Licensing

AgentDrive uses two licenses. The server is AGPL-3.0, so anyone can run, study and modify it, and a hosted fork has to stay open. The client packages are Apache-2.0, so any agent, IDE or product can embed them without copyleft obligations.

Copyright Roushan Inc.

## Per-path summary

| Path | What it is | License | SPDX |
|---|---|---|---|
| `apps/worker` | REST API and hosted MCP (Cloudflare Worker) | GNU AGPL v3 | `AGPL-3.0-only` |
| `apps/web` | Next.js site and dashboard | GNU AGPL v3 | `AGPL-3.0-only` |
| `packages/cli` | `@adrive/cli` (`adrive`) | Apache License 2.0 | `Apache-2.0` |
| `packages/mcp-server` | `@adrive/mcp-server` | Apache License 2.0 | `Apache-2.0` |
| `packages/sdk-ts` | `@adrive/sdk` | Apache License 2.0 | `Apache-2.0` |
| `packages/shared` | `@agentdrive/shared` types and primitives | Apache License 2.0 | `Apache-2.0` |
| `apps/installer` | One-line shell installer | Apache License 2.0 | `Apache-2.0` |
| `plugins/agentdrive` | Claude Code plugin | Apache License 2.0 | `Apache-2.0` |

Each path's own `LICENSE` file and `package.json` `license` field are authoritative. Anything not covered by a more specific `LICENSE` falls under the root `LICENSE` (AGPL-3.0).

## What the AGPL means in practice

You can, with no permission needed:

- Self-host the server for yourself, your team or your company, in production, at any scale.
- Read, audit, modify and fork the server code.
- Run an unmodified copy as a service for others.

The condition that matters: if you modify the server and let users interact with your modified version over a network, you must offer those users the complete corresponding source of your version under the AGPL (section 13 of the license). Distributing modified copies carries the usual GPL obligations as well.

## The clients are unaffected

The CLI, MCP server, SDK, shared types, installer and plugin are Apache-2.0 and stay that way. Embed them in commercial or closed-source products, fork them, or redistribute them under the Apache terms.

Talking to an AGPL server over its network API does not make your code AGPL. That holds whether the server is the hosted service at `app.agentdrive.sh` or a copy you run yourself. The copyleft applies to the server code and modifications of it, not to programs that call it.

## Commercial license

Organizations that cannot use AGPL software, or that want to ship a modified server without publishing their changes, can buy a commercial license from Roushan Inc. Contact `licensing@agentdrive.sh`.

## Contributions and the CLA

Every contributor signs the Contributor License Agreement in [`CLA.md`](./CLA.md) before a pull request can be merged. You keep the copyright in your contribution. The CLA grants Roushan Inc a license broad enough to keep offering the commercial license above and to relicense the project if that is ever needed. A bot asks for the signature on your first pull request; see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Trademarks

The code licenses do not grant any rights to the AgentDrive name or logo. See [`TRADEMARKS.md`](./TRADEMARKS.md).

## History

Before the open-source release, the server was licensed under the Business Source License 1.1. The reasoning for the change is recorded in [ADR-0009](./docs/tech/adr/0009-agpl-server-license.md).
