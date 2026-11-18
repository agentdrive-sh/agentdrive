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

`pnpm --filter @agentdrive/web dev` starts the website and dashboard at http://localhost:3001. See [`docs/tech/architecture.md`](./docs/tech/architecture.md) for how the pieces fit.

Every change lands through a pull request against `main`, and CI must pass on its head before it merges. CI does not run on GitHub Actions: a maintainer reads your diff, then runs `scripts/ci.sh --pr <n>` on their own machine. It tests GitHub's merge of your branch into `main` and posts each job (Typecheck, Test, Build, Verify claims, Browser regressions, Production dependency audit) as a status on your pull request's head commit. You can run the same checks yourself before you push: `scripts/ci.sh` tests your last commit in a clean temporary worktree, so uncommitted changes do not count, and its exit code and summary table are the result. In a clone of this repo it posts no statuses; in your fork it posts them to the fork when `gh` is signed in. It needs Node 22, `pnpm`, `jq` and `git`. Keep pull requests small and focused; open an issue first if you plan a large change.

The maintainers develop in a private repository and publish each release here as one sync commit (its message names the internal commit). Pull requests opened here are reviewed and squash-merged here as usual, and carried into the private repository before the next release, so nothing you contribute is overwritten.

## Contributor License Agreement

Before your first pull request can merge, you sign the [CLA](./CLA.md) by commenting on the pull request with exactly this sentence:

> I have read the CLA Document and I hereby sign the CLA

You do it once, and it covers all your future contributions. The maintainer's CI run records your signature and sets the `cla` status; until then that status names the commit authors who have not signed. Every commit must be authored with an email linked to your GitHub account, or there is no login to match the signature to. You keep the copyright in your work. The CLA lets Roushan Inc offer AgentDrive under a commercial license alongside the AGPL; [`LICENSING.md`](./LICENSING.md) explains why. If you contribute on behalf of your employer, have them email `licensing@agentdrive.sh` too.

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
- **Tests** use Vitest. Worker tests live in `apps/worker/test/`, CLI tests in `packages/cli/test/`, MCP server and transcript tests in `packages/mcp-server/test/`.
- **Licenses follow the package.** A new file takes the license of the package it lands in (AGPL-3.0 for `apps/worker` and `apps/web`, Apache-2.0 for the clients), so put code in the right package.

[`docs/tech/architecture.md`](./docs/tech/architecture.md) covers the storage layout and auth model in full.

## Where to start

The best first contributions are **harness adapters**: code that reads another agent's session transcripts from disk so `adrive sync` can upload them and `adrive resume` can hand them to a different agent.

Adapters live in [`packages/mcp-server/src/transcripts/`](./packages/mcp-server/src/transcripts/), where both the CLI (sync) and the MCP server (local resume with no account) use them:

- [`types.ts`](./packages/mcp-server/src/transcripts/types.ts) defines the `TranscriptSource` interface. An adapter does two things: `enumerate()` finds candidate sessions on disk, and `parseSession()` turns one into a `TranscriptDoc` (turns, cwd, title, files touched). Redaction, encryption and upload are handled centrally in `packages/cli/src/lib/sync.ts` (sync) and `packages/mcp-server/src/local.ts` (local resume), so adapters stay small.
- [`claude.ts`](./packages/mcp-server/src/transcripts/claude.ts) is the reference adapter: Claude Code's JSONL transcripts under `~/.claude/projects/`, under 100 lines. [`util.ts`](./packages/mcp-server/src/transcripts/util.ts) has the shared helpers (`DocBuilder`, `jsonLines`, `mtimeOf`).
- Register the adapter in `HARNESSES` and `SOURCES` in [`packages/mcp-server/src/local.ts`](./packages/mcp-server/src/local.ts), add the harness id to `SessionHarness` in `packages/mcp-server/src/session.ts`, and add fixture-based tests to `packages/mcp-server/test/transcripts.test.ts` alongside the existing ones.
- If the harness's transcripts don't record the working directory, local mode can only match its sessions to a project through the cwd its hook records (`adrive hook` in `packages/cli/src/commands/hook.ts`), so wire a session-start hook for it too.

**Good first issues:** sync adapters for **Cline**, **Zed** and **Continue**. All three already reach AgentDrive through MCP, but none has native session sync, so their sessions cannot be resumed elsewhere. To propose or claim one, open an issue with the [harness adapter template](./.github/ISSUE_TEMPLATE/harness-adapter.md) and include where the harness stores its transcripts and a redacted sample of the format.

## Reporting bugs and security issues

Open a GitHub issue for bugs, with steps to reproduce. Do not file security vulnerabilities as public issues; email `security@agentdrive.sh` instead.
