# AgentDrive auth.md

AgentDrive authenticates AI agents and scripts that call the REST API (`https://app.agentdrive.sh/v1`) or the hosted MCP server (`https://mcp.agentdrive.sh/mcp`) with API keys. MCP clients can instead connect to the hosted MCP server with OAuth 2.1 (see below); OAuth tokens are accepted only on the MCP endpoint, not the REST API.

## Register an agent (anonymous)

```http
POST https://app.agentdrive.sh/v1/register
Content-Type: application/json

{ "agent_name": "my-agent", "org_name": "optional" }
```

- `agent_name`: required, 1-100 characters. `org_name`: optional, 1-100 characters; defaults to `<agent_name>'s org`.
- No credentials needed. Rate-limited to 5 requests per minute per IP.
- Each call creates a new organization on the Free plan, which does not expire.
- Response `201`:

```json
{
  "success": true,
  "data": {
    "agent_id": "ag_...",
    "api_key": "agentdrive_live_...",
    "org_id": "org_...",
    "org_name": "...",
    "plan": "trial",
    "trial_ends_at": "2026-01-01T00:00:00.000Z",
    "agent_email": "optional",
    "agent_claim_url": "optional"
  }
}
```

The `api_key` is shown once and never again. `agent_email` and `agent_claim_url` are present only when inbox provisioning is available.

## Keys linked to a human account

- CLI: `adrive auth login` opens a browser sign-in and stores an API key locally.
- Dashboard: create and manage keys at https://app.agentdrive.sh/keys.

## Use the credential

Send the key as a Bearer token on every request:

```http
Authorization: Bearer agentdrive_live_...
X-Agent-Platform: claude-code
X-Agent-Role: reviewer
```

`X-Agent-Platform` and `X-Agent-Role` are optional. They record which agent tool and role wrote each artifact; an unrecognized platform is recorded as `unknown`, and the role is truncated to 64 characters.

The same header authenticates the hosted MCP server at `https://mcp.agentdrive.sh/mcp` (Streamable HTTP).

## OAuth for MCP clients

The hosted MCP server follows the MCP authorization spec, so clients such as claude.ai and ChatGPT connectors can connect without a pasted key:

- An unauthenticated request to `https://mcp.agentdrive.sh/mcp` returns `401` with `WWW-Authenticate: Bearer resource_metadata="https://mcp.agentdrive.sh/.well-known/oauth-protected-resource/mcp"`.
- The authorization server is `https://agentdrive.sh` (metadata at `/.well-known/oauth-authorization-server`).
- Clients register with Dynamic Client Registration (`POST https://agentdrive.sh/auth/register`) or use a Client ID Metadata Document URL as their `client_id`.
- Authorization code grant with PKCE (`S256` required), scope `mcp`, resource `https://mcp.agentdrive.sh/mcp`.
- A person signs in and approves the client. Approval creates an API key for that connection, listed at https://app.agentdrive.sh/keys; revoking it there disconnects the client.

## Revoke a key

```http
DELETE https://app.agentdrive.sh/v1/keys/:key_id
Authorization: Bearer agentdrive_live_...
```

Requires an API key or dashboard session belonging to the same organization. List keys and their `key_id` values with `GET https://app.agentdrive.sh/v1/keys`.

Docs: https://agentdrive.sh/docs/rest-api
