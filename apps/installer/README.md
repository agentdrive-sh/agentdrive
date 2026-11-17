# @agentdrive/installer

The POSIX shell installer that powers the one-line setup:

```
curl -fsSL agentdrive.sh/install | sh
```

(`app.agentdrive.sh/install` also serves the script.)

## What it does

1. Detects platform (`Darwin`/`Linux`, `arm64`/`x64`).
2. Verifies Node.js 22.15+ is on `PATH`. If missing, prints platform-specific install hints and exits 1 — it never installs Node for you.
3. Picks a package manager in order: `npm` -> configured `pnpm` -> `yarn`.
4. Installs `@adrive/cli` globally with that package manager. Prompts before using `sudo` if the global prefix is not writable.
5. Runs `adrive init` through an accessible controlling terminal, including under `curl | sh`; otherwise prints a manual setup step.
6. Prints next steps.

The script is plain POSIX `sh` (no bashisms), under 300 lines, and idempotent — re-running it on an already-installed machine just upgrades the CLI and re-runs `adrive init`.

## Manual fallback

If you would rather not pipe a script into your shell:

```
npm install -g @adrive/cli
adrive init
```

`pnpm add -g @adrive/cli` and `yarn global add @adrive/cli` work the same way.

## Security note

Always review a script before piping it into your shell:

```
curl -fsSL agentdrive.sh/install | less
```

Source of truth: [`install.sh`](./install.sh) in this repo. The Worker route at `GET /install` and `GET /install.sh` serves the exact bytes of that file via a build step (`build.mjs`).

## Local development

```
pnpm --filter @agentdrive/installer build      # regenerate the worker-embedded copy
pnpm --filter @agentdrive/installer test       # vitest + sh -n syntax check
sh -n apps/installer/install.sh                # syntax check standalone
```
