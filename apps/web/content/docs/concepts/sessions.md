---
title: Sessions
description: 'How AgentDrive syncs coding-agent sessions in the background and lets another agent resume them, with privacy controls, Private Workspace and per-agent notes.'
---

A session is one conversation in an agent CLI. AgentDrive syncs sessions from Claude Code, Codex, OpenCode, Cursor and Antigravity into your workspace, so any of them can pick up work another one started.

## How sync works

1. **The agent's hook runs `adrive hook <harness>`.** The installer (or the Claude Code plugin) registers it on session start, turn end, session end and compaction. The hook reads the event, starts a detached sync and exits right away, so it never blocks the agent. A failing hook never surfaces in your session.
2. **A detached `adrive sync` uploads the session.** It reads the agent's local transcript, renders it as markdown, redacts it and writes it to `sessions/<project>/<harness>/<session-id>.md`. Files the agent wrote that git doesn't track are uploaded under `sessions/<project>/files/`.
3. **A run `<harness>:<session-id>` is upserted for provenance.** The run carries the session title, its status, the files it uploaded and the paths it touched, and it is stamped with the agent as its platform.
4. **Any agent can resume it.** See below.

Turn-end events re-sync a session at most every two minutes. Session-end and compaction events always sync. Each sync also sweeps every agent for sessions that changed since the last sweep, so a session from an agent that crashed still lands, and is marked finished after 30 minutes idle.

### The project key

Sessions are grouped by project so every agent files the same repo in the same place:

- With a git remote: the normalized remote, such as `github.com__acme__api`.
- A local repo without a remote: the repo folder name plus a short hash of its path.
- Anywhere else: `local__<folder>-<hash>`.

Sessions from Claude Code worktrees file under their parent repo.

## Resume, three ways

All three load the same handoff format. MCP resume prefers a recent session in this project from a **different** agent, falling back to the latest session if none exists. Shell `adrive resume` selects the latest session regardless of agent; pass an explicit session id to choose another.

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

A fresh install turns transcript and artifact sync on and prints a notice saying so. With both off, hooks don't sync anything, but in CLI 1.4.0 the skipped sessions aren't marked, so sessions from the off period upload once you turn sync back on. With only transcript sync off, each session's run record, with its title, working directory and touched paths, is still sent. Private Workspace keeps those three out of the run record and encrypts what does upload, so turn it on for sensitive work, and keep secrets out of the chat.

### What gets uploaded, and what doesn't

During hook sync, a touched file is uploaded only if all of these hold:

- It is inside your home directory or the session's project.
- It doesn't match the built-in deny list: `.env` files, `.dev.vars`, SSH and cloud credentials, `.npmrc`, `.netrc`, key and certificate files, `credentials.json`, `auth.json`, shell history, SQLite databases, `node_modules/`, build output and similar. A project's `.adriveignore` can't override this list.
- It doesn't match the project's `.adriveignore` (a gitignore subset: `#` comments, `!` negation, `/` anchoring, `*` and `**`).
- It is untracked and not ignored by git, or it sits outside any repository.
- It is 1 MB or smaller and not binary.

`adrive watch [path]` works differently and needs artifact sync on. It is meant to upload every file under the folder (the current one by default), existing files first, then each change, and it does not check whether git tracks a file. In CLI 1.4.0 it uploads nothing, because of a bug fixed in the next release; use hook sync or `adrive push` meanwhile. Watch merges the built-in deny list, that folder's `.adriveignore` and its `.gitignore` into one list, and the last matching rule wins, so a `!` line can re-include a denied file.

Transcripts and uploaded files then pass through a redactor that replaces common secret shapes, such as cloud keys, API tokens, JWTs, PEM private keys and `NAME_KEY=value` assignments, with markers like `[redacted:openai-key]`.

**Redaction is best-effort, not a security boundary.** Pattern matching misses secrets that don't look like secrets. Ignore rules exclude artifact files, not transcript text. Use Private Workspace for locally encrypted uploads, or disable transcript sync for conversations that must stay on your machine.

## Private Workspace

With Private Workspace on:

- Transcripts and synced files are encrypted on your machine with AES-256-GCM before upload. The data key is generated locally and kept, wrapped, in `~/.config/agentdrive/`. The server stores only ciphertext.
- Session paths are hashed too. The project key becomes `p-` plus a 16-character hash, and synced files are stored under hashed names, so repo and file names don't appear in storage paths.
- Run metadata leaves out the working directory, the title and touched paths, and shows the session as "Private session".
- `drive_resume` can't decrypt, so it asks the agent to run `adrive resume <id>`, which decrypts locally.

Turning Private Workspace on or off, or switching account or workspace, makes the next sync start over and re-upload recent sessions under the new settings.

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
