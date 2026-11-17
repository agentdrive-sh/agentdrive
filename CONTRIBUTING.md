# Contributing to AgentDrive

Thanks for helping. This guide covers setup, the CLA, house style and good places to start.

## Dev setup

Requirements: Node.js 22.15 or later and pnpm 10 (the exact version is pinned in `package.json` under `packageManager`; `corepack enable` picks it up).

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm dev:worker      # local API at http://localhost:8787
```

`pnpm dev:frontend` and `pnpm dev:docs` start the other apps. See [`docs/tech/architecture.md`](./docs/tech/architecture.md) for how the pieces fit.

Every change lands through a pull request against `main`, and CI (typecheck and tests) must be green before it merges. Nobody pushes to `main` directly. Keep pull requests small and focused; open an issue first if you plan a large change.

## Contributor License Agreement

Before your first pull request can merge, you sign the [CLA](./CLA.md). A bot comments on the pull request with instructions; you reply with the sentence it gives you, once, and it covers all your future contributions. You keep the copyright in your work. The CLA lets Roushan Inc offer AgentDrive under a commercial license alongside the AGPL; [`LICENSING.md`](./LICENSING.md) explains why. If you contribute on behalf of your employer, have them email `licensing@agentdrive.sh` too.

## House style

- **TypeScript only.** No new JavaScript files. Avoid `any`; if it is unavoidable, say why in a comment.
- **pnpm only.** Never `npm install` or `yarn add` inside the monorepo; use `pnpm add` or `pnpm --filter <pkg> add`.
- **Hono for routing, Zod for validation, the MCP SDK for tools.** Do not introduce other frameworks for the same job.
- **Comments explain why, not what.** Names should say what the code does. Comment only a hidden constraint, a workaround or a subtle invariant.
- **No emojis** in code, comments, commit messages or shipped files.
- **No backwards-compat shims and no half-finished stubs.** Delete unused code instead of deprecating it in place.
- **Small diffs over rewrites.** Ask before a large refactor.
- **Never bypass hooks** with `--no-verify`; fix the cause.
- **Storage is KV and R2 only.** No Postgres, Neon or D1. Do not change KV key shapes without updating `apps/worker/src/services/storage.ts` and planning a backfill. List KV with cursor pagination, never a `limit` above 1000.
- **Permissions** go through `hasPermission(actual, required)`; never compare role strings.
- **Tests** use Vitest. Worker tests live in `apps/worker/test/`, CLI tests in `packages/cli/test/`.

[`CLAUDE.md`](./CLAUDE.md) has the longer version, including storage layout and auth model. It doubles as the guide for AI coding agents working in this repo.

## Where to start

The best first contributions are **harness adapters**: code that reads another agent's session transcripts from disk so `adrive sync` can capture them and `adrive resume` can hand them to a different agent.

Adapters live in [`packages/mcp-server/src/transcripts/`](./packages/mcp-server/src/transcripts/), where both the CLI (capture) and the MCP server (local resume with no account) use them:

- [`types.ts`](./packages/mcp-server/src/transcripts/types.ts) defines the `TranscriptSource` interface. An adapter does two things: `enumerate()` finds candidate sessions on disk, and `parseSession()` turns one into a `TranscriptDoc` (turns, cwd, title, files touched). Redaction, encryption and upload are handled centrally in `packages/cli/src/lib/sync.ts` (capture) and `packages/mcp-server/src/local.ts` (local resume), so adapters stay small.
- [`claude.ts`](./packages/mcp-server/src/transcripts/claude.ts) is the reference adapter: Claude Code's JSONL transcripts under `~/.claude/projects/`, under 100 lines. [`util.ts`](./packages/mcp-server/src/transcripts/util.ts) has the shared helpers (`DocBuilder`, `jsonLines`, `mtimeOf`).
- Register the adapter in `HARNESSES` and `SOURCES` in [`packages/mcp-server/src/local.ts`](./packages/mcp-server/src/local.ts), add the harness id to `SessionHarness` in `packages/mcp-server/src/session.ts`, and add fixture-based tests to `packages/mcp-server/test/transcripts.test.ts` alongside the existing ones.
- If the harness's transcripts don't record the working directory, local mode can only match its sessions to a project through the cwd its hook records (`adrive hook` in `packages/cli/src/commands/hook.ts`), so wire a session-start hook for it too.

**Good first issues:** capture adapters for **Cline**, **Zed** and **Continue**. All three already reach AgentDrive through MCP, but none has native session capture, so their sessions cannot be resumed elsewhere. To propose or claim one, open an issue with the [harness adapter template](./.github/ISSUE_TEMPLATE/harness-adapter.md) and include where the harness stores its transcripts and a redacted sample of the format.

## Reporting bugs and security issues

Open a GitHub issue for bugs, with steps to reproduce. Do not file security vulnerabilities as public issues; email `security@agentdrive.sh` instead.
