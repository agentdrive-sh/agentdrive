# @adrive/mcp-server

MCP server for **[AgentDrive](https://agentdrive.sh)**: shared workspace for coding agents. Capture sessions from Claude Code, Codex, OpenCode, Cursor and Antigravity, resume them in any of the others, and search everything they wrote. Provenance on every artifact; portable storage on R2, S3 or your own bucket.

Hit a usage limit in one agent? Call `drive_resume` in another and it loads the handoff: the goal, the files touched and the latest turns. Also hosted at `https://mcp.agentdrive.sh/mcp` (streamable HTTP, `Authorization: Bearer <AgentDrive API key>`). Free plan, no credit card: [agentdrive.sh/pricing](https://agentdrive.sh/pricing).

## Install

```sh
pnpm dlx @adrive/mcp-server
# or
npx @adrive/mcp-server
```

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `AGENTDRIVE_API_KEY` | no | key saved by `adrive auth login` | Falls back to `~/.config/agentdrive/config.json`, so client configs never need the key inline. With no key at all the server still starts and offers one tool, `drive_connect`, which signs the user in through the browser and connects their other agent tools; the full toolset then appears in the same session. |
| `AGENTDRIVE_API_URL` | no | `https://app.agentdrive.sh` | Override for self-host or staging. |
| `AGENTDRIVE_AGENT_PLATFORM` | no | `unknown` | Identifies which host is calling. Valid: `claude-code | codex | opencode | gemini-cli | cursor | antigravity | langgraph | crewai | autogen | hermes | openclaw | unknown`. Unknown values downgrade to `unknown` server-side. |
| `AGENTDRIVE_AGENT_ROLE` | no | (empty) | Free-form role label (`planner`, `reviewer`, etc.). Stamped on every request for provenance. |

The server derives the current project from its working directory (git remote, else repo path), which scopes `drive_sessions` and `drive_resume`.

## Client configuration

`curl -fsSL https://agentdrive.sh/install | sh` runs `adrive init`, which wires every detected harness. For Claude Code, install the plugin instead: `/plugin marketplace add agentdrive-sh/agentdrive-mcp` then `/plugin install agentdrive@agentdrive`.

Manual entries, for reference:

### Codex CLI (`~/.codex/config.toml`)

```toml
[mcp_servers.agentdrive]
command = "npx"
args = ["-y", "@adrive/mcp-server"]

[mcp_servers.agentdrive.env]
AGENTDRIVE_AGENT_PLATFORM = "codex"
```

### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "agentdrive": {
      "command": "npx",
      "args": ["-y", "@adrive/mcp-server"],
      "env": { "AGENTDRIVE_AGENT_PLATFORM": "cursor" }
    }
  }
}
```

## Tools (22)

**Files**
- `drive_write` — create or update a file with versioning
- `drive_read` — read a file's content
- `drive_list` — list files (paginated automatically)
- `drive_delete` — delete a file

**Collaboration**
- `drive_share` — create a share link (optionally email-gated)
- `drive_comment` — leave a comment on a file
- `drive_feedback` — read comments on a file

**Provenance**
- `drive_activity` — workspace event feed
- `drive_versions` — file version history

**Sessions**
- `drive_sessions` — recent sessions in this project from every agent
- `drive_resume` — load a prior session's handoff (defaults to the latest from another harness)

**Search and memory**
- `drive_search` — semantic search across artifacts
- `drive_recall` — recall facts and preferences (narrows to extracted facts in a future release)
- `drive_context` — auto-pull relevant artifacts for the task you are about to do
- `drive_log_run` — record an agent run for cross-platform audit

**Org**
- `drive_invite` — invite a human teammate
- `drive_roles` — assign / list / remove per-workspace roles
- `drive_org` — view org details, agents, members, usage

**Sandbox (experimental; 503 unless the deployment has Cloudflare Containers)**
- `drive_sandbox_clone`, `drive_sandbox_exec`, `drive_sandbox_read`, `drive_sandbox_commit` — a per-workspace Linux sandbox

## License

Apache-2.0. See [LICENSE](https://github.com/agentdrive-sh/agentdrive-mcp/blob/main/LICENSE).
