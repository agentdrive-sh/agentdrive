---
title: Sessions
description: 'How AgentDrive syncs coding-agent sessions in the background and lets another agent resume them, with privacy controls, Private Workspace and per-agent notes.'
---

A session is one conversation in an agent CLI. AgentDrive syncs sessions from Claude Code, Codex, OpenCode, Cursor and Antigravity into your workspace, so any of them can pick up work another one started.

## How sync works

1. **The agent's hook runs `adrive hook <harness>`.** The installer (or the Claude Code plugin) registers it on session start, turn end, session end and compaction. The hook reads the event, starts a detached sync and exits right away, so it never blocks the agent. A failing hook never surfaces in your session.
2. **A detached `adrive sync` uploads the session.** It reads the agent's local transcript, renders it as markdown, redacts it and writes it to `sessions/<project>/<harness>/<session-id>.md`. Files the agent wrote that git doesn't track are uploaded under `sessions/<project>/files/`.
3. **A run `<harness>:<session-id>` is upserted for provenance.** From `@adrive/cli` 1.5.0, a run is sent only for a session whose transcript syncs; 1.4.0 sends it even with transcript sync off. The run carries the session title, its status, the files it uploaded and the paths it touched, and it is stamped with the agent as its platform.
4. **Any agent can resume it.** See below.

Turn-end events re-sync a session at most every two minutes. Session-end and compaction events always sync. Each sync also sweeps every agent for sessions that changed since the last sweep, so a session from an agent that crashed still lands, and is marked finished after 30 minutes idle.

### The project key

Sessions are grouped by project so every agent files the same repo in the same place:

- With a git remote: the normalized remote, such as `github.com__acme__api`.
- A local repo without a remote: the repo folder name plus a short hash of its path.
- Anywhere else: `local__<folder>-<hash>`.

Sessions from Claude Code worktrees file under their parent repo.

## Resume, three ways

All three load the same handoff format. MCP resume prefers a recent session in this project from a **different** agent, falling back to the latest session if none exists. From `@adrive/cli` 1.5.1, signed-in shell `adrive resume` does the same when it can tell which agent's shell it runs in, and says so when it falls back; from a plain terminal, or in 1.5.0 and earlier, it selects the latest session regardless of agent. Pass an explicit session id to choose another.

- **MCP tools**, from any connected agent: `drive_sessions` lists recent sessions across agents, and `drive_resume` loads one. Pass a `session_id` from `drive_sessions`, or nothing for the default.
- **Slash commands:** `/agentdrive:resume` and `/agentdrive:sessions` in Claude Code, and `/agentdrive-resume` and `/agentdrive-sessions` in OpenCode and Cursor. Codex has no AgentDrive command: ask it in plain words, or start the request with `$agentdrive` to call the AgentDrive skill. (Init still writes `agentdrive-resume` and `agentdrive-sessions` custom prompts, which only older Codex versions load.) Antigravity has no custom commands, so it gets `agentdrive-resume` and `agentdrive-sessions` skills instead: ask it to resume or list your AgentDrive sessions.
- **Shell:** `adrive resume` prints the brief for the latest session, `adrive resume <id>` for a specific one, and `adrive resume --list` lists sessions.

The brief fits a character budget (12,000 by default; `max_chars` takes up to 50,000, and the CLI's `--max-chars` has no upper limit). It contains the source session's metadata, the goal (its first user message), the files touched with ids of the uploaded copies, and as many recent turns as fit. The agent is told to check file state on disk before relying on it.

When auto-context is on, the session-start hook also tells the new agent about up to three recent sessions in this project, the newest from each other agent first. OpenCode can't receive context from a plugin, so it doesn't get this hint.

## Privacy controls

Run `adrive privacy` to step through the toggles, `adrive privacy --show` to print them, or set one directly:

| Toggle | Flag | What it controls |
|---|---|---|
| Auto-context | `--auto-context on\|off` | The session-start list of recent sessions from other agents |
| Artifact sync | `--capture-artifacts on\|off` | Uploading files your agents wrote that git doesn't track, and allowing `adrive watch` (below) |
| Transcript sync | `--capture-transcripts on\|off` | Uploading session transcripts |
| Private Workspace | `--private-workspace on\|off` | Client-side encryption, described below |

A fresh install turns transcript and artifact sync on and prints a notice saying so. The first sync then uploads your sessions from the last 14 days, from every supported agent on this machine, except, from `@adrive/cli` 1.5.0, ones that ran while sync was off.

### Turning sync off

To keep a session on your machine, run `adrive privacy --capture-transcripts off` before you start it. Add `--capture-artifacts off` so the files it writes don't sync while it's off.

From `@adrive/cli` 1.5.0:

- A session that is active at any point while transcript sync is off never has its transcript synced. That holds after you turn sync back on, if you continue the session afterwards, and after you switch account, workspace or Private Workspace. The CLI's sync sends no run for it either.
- In the same way, the files a session touches never sync if it was active at any point while artifact sync was off.
- A file changed while artifact sync is off doesn't sync either, even through a session that ran while sync was on. It counts as changed while sync was off if either its modification time or its status-change time falls while it was off. The status-change time catches a copy that keeps an old modification time (`cp -p`, `rsync -a`, a Finder copy) or one backdated with `touch`. Because either time is enough, a later permissions change, rename or hard link doesn't release an edit made while sync was off. A metadata-only change while sync is off also keeps the file local. The file stays local until it is really edited again after you turn artifact sync back on; then its whole current content syncs, including what was written while sync was off. One case still slips through: content copied in with an old modification time while sync was off, followed by only a metadata change after it is back on.
- Every upload that background sync or `adrive watch` makes, whether a transcript, a run or a file, is checked against your current settings and the history right before it is sent, and again before any retry. Turning a toggle off stops a sync that's already running at once, and pauses a running `adrive watch` until it's back on. Only an upload already on its way when you flip the toggle can still arrive. Something held back only because sync was off at that moment, or because `config.json` couldn't be read just then, isn't dropped: a later sync tries it again, and a paused `adrive watch` keeps it queued and uploads it once sync is back on, unless it changed while sync was off. Explicit commands such as `adrive push` and `adrive run-log`, and the MCP tool `drive_write`, aren't gated by the sync toggles.
- A session counts as active from its first timestamp to its last activity. Without a timestamp, it counts from when its transcript file was created; if that isn't known either, from the beginning, so it stays local.
- `adrive` commands that change `config.json` take turns, and the history is updated in the same step, so a sign-in, a newly connected tool or a second `adrive privacy` can't undo a toggle you just set.
- Each interval a toggle was off is kept in `~/.config/agentdrive/privacy-history.json`, and a `privacy-history.marker` file beside it records that one exists. Logging out leaves both in place, and 1.4.0 never touches them. If the history then goes missing, can't be read or can't be written, nothing syncs until you restore it from a backup of `privacy-history.json`. Writing an empty file doesn't restore it, and neither does logging out and back in. Only deleting the marker too (or the whole `~/.config/agentdrive/` folder) starts over with no history, which lets sessions from earlier off intervals sync.
- The history is per machine. If you copy `config.json` to another machine, that machine starts with no history: its sessions count as run while sync was on, unless the copied config has a toggle off, which opens an interval at the first hook or `adrive` command. Copy `privacy-history.json` and the marker with it to keep the intervals.
- If you upgrade from 1.4.0 with sync already off, every session from before you turn it back on counts as run while off.
- With sync off, a hook's sync uploads nothing. At session start it still connects newly installed agent tools.
- Anything that synced before you turned sync off stays in your workspace.

Three cases still slip past this, also from 1.5.0:

- If the wall clock is set back between turning sync off and on (by hand, or a large time sync), the recorded interval can end up shorter than the time sync was actually off.
- If you turn a toggle off and back on by editing `config.json`, and no `adrive` command, agent hook or running `adrive watch` checks in between, nothing records the change.
- An interrupted sign-in can leave `config.json` with an API key but no saved preferences. That counts as no choice yet, so nothing is recorded until preferences are saved.

The CLI's sync isn't the only thing that talks to AgentDrive. While sync is off, an agent connected to the AgentDrive MCP server can still call `drive_write`, `drive_log_run` or `drive_context` itself. With auto-context on, the session-start hook still asks for recent runs in the project, and that request names the project key (hashed in a Private Workspace). To keep a session entirely to yourself, also turn auto-context off and disconnect the MCP server.

In `@adrive/cli` 1.4.0 and earlier, turning sync off only pauses it. With both toggles off, hooks don't sync anything, but the skipped sessions aren't marked, so sessions from the off period upload once you turn sync back on. With only transcript sync off, each session's run record, with its title, working directory and touched paths, is still sent. On 1.4.0, Private Workspace keeps those three out of the run record and encrypts what does upload, so turn it on for sensitive work, and keep secrets out of the chat. Upgrade the CLI before relying on sync off.

### What gets uploaded, and what doesn't

During hook sync, a touched file is uploaded only if all of these hold:

- It is inside your home directory or the session's project.
- It doesn't match the built-in deny list: `.env` files, `.dev.vars`, SSH and cloud credentials, `.npmrc`, `.netrc`, key and certificate files, `credentials.json`, `auth.json`, shell history, SQLite databases, `node_modules/`, build output and similar. A project's `.adriveignore` can't override this list. From `@adrive/cli` 1.5.0, it matches names in any letter case, so `.ENV` and `ID_RSA` are denied too. On a case-sensitive disk that also skips names such as `Build/` or `AUTH.JSON`.
- It doesn't match the project's `.adriveignore` (a gitignore subset: `#` comments, `!` negation, `/` anchoring, `*` and `**`).
- It is untracked and not ignored by git, or it sits outside any repository.
- It is 1 MB or smaller and not binary.
- From `@adrive/cli` 1.5.0, it has no other hard links (a hard link can carry a denied file, such as `~/.ssh/config`, under another name). Files in a tree copied with `cp -al`, or any other hard-link copy, are skipped for the same reason.

`adrive watch [path]` works differently and needs artifact sync on. It is meant to upload every file under the folder (the current one by default), existing files first, then each change, and it does not check whether git tracks a file. In CLI 1.4.0 it uploads nothing, because of a bug fixed in the next release; use hook sync or `adrive push` meanwhile. 1.4.0's watch also merges the built-in deny list, that folder's `.adriveignore` and its `.gitignore` into one list where the last matching rule wins, so a `!` line can re-include a denied file. From `@adrive/cli` 1.5.0, watch works. It checks artifact sync before each upload and pauses while it's off. Files queued during a pause upload when sync is back on, and files changed while it was off are skipped. `adrive watch --dry-run` works with artifact sync off and lists each file it would upload or hold back, and so does `adrive sync --dry-run`. If `config.json` can't be read for a while, watch says once that files are waiting, and uploads them once it can. A stuck upload gives up after 60 seconds, and stopping watch waits at most two seconds for the upload in progress. It reads only regular files, so FIFOs, sockets and devices are never opened. It skips links, files with more than one hard link, any file whose real path is on the built-in deny list in any letter case (it won't watch `~/.ssh` or a folder inside one), and anything matched by the `.gitignore` or `.adriveignore` at the folder's top level. No ignore file can re-include a denied file, nested ignore files are not read, and each file is checked again right before it is read, so one swapped for a link meanwhile isn't read.

The link and hard-link checks in hook sync and watch cover links that sit in the folder, such as ones a cloned repo carries. They don't defend against another program running as you that swaps folders for links while sync reads, since such a program can read your files directly anyway.

Transcripts and uploaded files then pass through a redactor that replaces common secret shapes, such as cloud keys, API tokens, JWTs, PEM private keys and `NAME_KEY=value` assignments, with markers like `[redacted:openai-key]`.

**Redaction is best-effort, not a security boundary.** Pattern matching misses secrets that don't look like secrets. Ignore rules exclude artifact files, not transcript text. Use Private Workspace for locally encrypted uploads, or turn transcript sync off before conversations that must stay on your machine.

## Private Workspace

With Private Workspace on:

- Transcripts and synced files are encrypted on your machine with AES-256-GCM before upload. The data key is generated locally and kept, wrapped, in `~/.config/agentdrive/`. The server stores only their ciphertext. Files written with `drive_write` or other MCP tools are not encrypted.
- Session paths are hashed too. The project key becomes `p-` plus a 16-character hash, and synced files are stored under hashed names, so repo and file names don't appear in storage paths.
- Run metadata leaves out the working directory, the title and touched paths, and shows the session as "Private session".
- `drive_resume` can't decrypt, so it asks the agent to run `adrive resume <id>`, which decrypts locally.

Turning Private Workspace on or off, or switching account or workspace, makes the next sync start over and re-upload recent sessions under the new settings. From `@adrive/cli` 1.5.0, sessions that ran while sync was off still stay local.

## Per-agent notes

| Agent | Setup | Hook events |
|---|---|---|
| Claude Code | Plugin: `/plugin marketplace add agentdrive-sh/agentdrive-mcp`, then `/plugin install agentdrive@agentdrive` | `SessionStart`, `Stop`, `SessionEnd`, `PreCompact` |
| Codex | Installer writes `~/.codex/hooks.json` and `config.toml`. Setup approves the AgentDrive hooks; on older Codex versions, approve them once via `/hooks`. | `SessionStart`, `Stop`, `SessionEnd`, `PreCompact` |
| OpenCode | Installer adds a plugin in `~/.config/opencode/plugins/` and the MCP server in `opencode.json`. A commented `opencode.jsonc` is left for you to edit by hand. | `session.created`, `session.idle` |
| Cursor | Installer merges `~/.cursor/hooks.json` and `~/.cursor/mcp.json`. | `sessionStart`, `stop`, `sessionEnd`, `preCompact` |
| [Antigravity](/integrations/antigravity) | Installer merges hooks into `~/.gemini/config/hooks.json` and the MCP server into `~/.gemini/config/mcp_config.json`, and adds skills under `~/.gemini/config/skills/`. One setup covers the `agy` CLI, the Antigravity app and the IDE. There is no session-end event, so a session is marked finished after 30 minutes idle. The installer also creates or updates `~/.gemini/settings.json` with hooks and the MCP server, adds commands under `~/.gemini/commands/agentdrive`, and syncs sessions from `~/.gemini/tmp`. | `SessionStart`, `Stop` (in `settings.json`: `SessionStart`, `AfterAgent`, `SessionEnd`, `PreCompress`) |

Install everything except the Claude Code plugin with `curl -fsSL agentdrive.sh/install | sh`. Cline, Zed and Continue are wired as plain MCP clients: they can call `drive_sessions` and `drive_resume`, but their own sessions aren't synced.

To see what a sync would pick up without uploading anything, run `adrive sync --dry-run`. Hook-started syncs log to `~/.config/agentdrive/sync.log`.
