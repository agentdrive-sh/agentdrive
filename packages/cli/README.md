# @adrive/cli

The `adrive` binary — a thin CLI for [AgentDrive](https://agentdrive.sh), the cross-agent artifact workspace with provenance and portable storage across Claude Code, Codex, Cursor, and LangGraph.

## Install

```sh
npm i -g @adrive/cli
adrive init
```

Or use the one-line installer:

```sh
curl -fsSL agentdrive.sh/install | sh
```

`adrive init` opens a browser to log you in (no localhost server, polling-style), then auto-detects installed agent tools (Claude Code, Cursor, Codex CLI, Cline, Continue, Zed) and wires the AgentDrive MCP server into each.

## Configuration

Stored at `$XDG_CONFIG_HOME/agentdrive/config.json`, falling back to `~/.config/agentdrive/config.json`. The file is chmod 600. Schema:

```json
{
  "api_url": "https://app.agentdrive.sh",
  "api_key": "agentdrive_live_...",
  "agent_id": "ag_...",
  "org_id": "org_...",
  "agent_platform": "cli",
  "default_workspace": "ws_..."
}
```

## Commands

| Command | Purpose |
|---|---|
| `adrive init` | Log in once, then wire capture hooks, MCP and resume commands into every installed agent tool |
| `adrive auth login` | Open browser, log in, store API key |
| `adrive auth logout` | Wipe local credentials |
| `adrive auth status` | Show whether you're logged in + masked key |
| `adrive whoami` | Print principal info from the API |
| `adrive ls` | List workspaces |
| `adrive push <file> [--workspace ws] [--remote-path p]` | Upload a local file |
| `adrive pull <ws-id>/<path> [-o out]` | Download a file (stdout by default) |
| `adrive search <query> [--top-k N] [--platform claude-code] [--workspace ws]` | Semantic search across artifacts |
| `adrive context <task> [--limit N] [--workspace ws]` | Auto-pull artifacts relevant to a task |
| `adrive run-log <task> [--status success|failure|partial] [--ref f] [--produced f]` | Log an agent run |
| `adrive billing` | Open the Stripe billing portal in your browser |
| `adrive plan` | Show current plan, usage, and quotas |
| `adrive upgrade [pro\|team]` | Open the upgrade page in your browser (default: the next plan up) |

`-v` / `--version` and `--help` work at every level.

## Authentication

`adrive` uses Cursor-style polling auth — no localhost server:

1. `adrive auth login` calls `POST /v1/auth/cli/start` to get a short-lived auth URL, a code like `WXYZ-2345`, and a poll secret that never leaves the CLI.
2. The CLI prints the URL and the code, and opens the URL in your default browser. You sign in (Google, GitHub, or email magic link) and type the code from your terminal. Only ever enter a code from your own terminal: AgentDrive never asks you to enter a code someone sent you.
3. The CLI polls `POST /v1/auth/cli/poll` every 1.5s for up to 10 minutes. Five wrong codes cancel the login.
4. On success, the returned `api_key` is stored at chmod 600. The server hands it out once.

If the browser does not auto-launch (e.g. headless server, SSH session), open the printed URL on any device and enter the code there.

## Auto-detect + wire

`adrive init` logs you in, then wires every agent harness it finds. API keys stay in `~/.config/agentdrive/config.json`; no harness config ever holds one.

| Tool | What init writes |
|---|---|
| Claude Code | Installs the `agentdrive` plugin (`claude plugin marketplace add agentdrive-sh/agentdrive-mcp` + `claude plugin install agentdrive@agentdrive`) |
| Codex CLI | `~/.codex/hooks.json`, `[mcp_servers.agentdrive]` in `~/.codex/config.toml`, `~/.codex/prompts/agentdrive-*.md`, `~/.codex/skills/agentdrive/` |
| OpenCode | `~/.config/opencode/plugins/agentdrive.ts`, `mcp.agentdrive` in `opencode.json`, `commands/agentdrive-*.md`, `skills/agentdrive/` |
| Cursor | `~/.cursor/hooks.json`, `~/.cursor/mcp.json`, `~/.cursor/commands/agentdrive-*.md`, `~/.cursor/skills/agentdrive/` |
| Antigravity (CLI, app, IDE) | `agentdrive` hook in `~/.gemini/config/hooks.json`, `~/.gemini/config/mcp_config.json`, `~/.gemini/config/skills/agentdrive*/`; also creates or updates `hooks` + `mcpServers` in `~/.gemini/settings.json` and adds `~/.gemini/commands/agentdrive/*.toml` |
| Claude Desktop, Cline, Continue, Zed | MCP server entry in their existing config |

Merges preserve everything else in each file, the first change to an existing file saves `<file>.bak`, and re-running init changes nothing. init also approves the AgentDrive hooks in Codex through `codex app-server` (only hooks whose command is exactly the one it wrote); if that fails it tells you to approve them via `/hooks`. Agent tools installed after init are wired at the next session start in any connected tool, once each (`adrive privacy --auto-wire off` turns this off).

## License

Apache-2.0.
