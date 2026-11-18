export interface Env {
  KV: KVNamespace;
  OAUTH_KV: KVNamespace;
  R2: R2Bucket;
  FILE_COLLAB: DurableObjectNamespace;
  BILLING_COORDINATOR: DurableObjectNamespace<import('./durable-objects/billing-coordinator.js').BillingCoordinator>;
  MAGIC_CODES: DurableObjectNamespace<import('./durable-objects/magic-codes.js').MagicCodes>;
  RESUME_METER: DurableObjectNamespace<import('./durable-objects/resume-meter.js').ResumeMeter>;
  RESUME_METER_EPOCH?: string;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  SEND_EMAIL: SendEmail;
  // Sandbox is OPTIONAL — the binding requires a Dockerfile + Containers plan.
  // When unbound, /v1/workspaces/:wid/sandbox/* endpoints return 503 and the
  // drive_sandbox_* MCP tools surface a clean "not configured" message.
  SANDBOX?: DurableObjectNamespace;
  // Workers Rate Limiting. Optional so a missing binding fails open instead of
  // failing every request.
  RL_PRINCIPAL?: RateLimit;
  RL_SEARCH?: RateLimit;
  RL_REGISTER?: RateLimit;
  RL_MAGIC?: RateLimit;

  ENVIRONMENT: string;
  APP_URL: string;
  // Where people land after sign-in, checkout and share links. APP_URL stays the API
  // host, which the OAuth providers have registered as the callback origin.
  SITE_URL: string;
  // Canonical hosted MCP resource (RFC 8707/9728); SITE_URL is the OAuth issuer.
  MCP_URL: string;
  // This account's workers.dev subdomain; CORS trusts only the agentdrive-web worker on it. Unset trusts none.
  WORKERS_DEV_SUBDOMAIN?: string;
  // Self service binding — the hosted /mcp tools dispatch REST calls in-process
  // through this instead of a loopback subrequest. Optional so tests (which
  // don't exercise tools/call) can omit it.
  SELF?: Fetcher;
  TOKEN_SIGNING_SECRET: string;
  // "true" refuses a Free org's resume past its monthly limit; anything else only warns.
  RESUME_METER_ENFORCE?: string;
  // "true" on a community self-hosted deploy (`pnpm selfhost`): no billing, no plan
  // limits, no upgrade prompts. Never set in the production wrangler.toml.
  SELF_HOSTED?: string;
  // One-time secret `pnpm selfhost` sets to register the operator, then deletes.
  SELF_HOSTED_BOOTSTRAP_TOKEN?: string;
  MAILMOLT_API_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_PRO?: string;
  STRIPE_PRICE_TEAM?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GITHUB_OAUTH_CLIENT_ID?: string;
  GITHUB_OAUTH_CLIENT_SECRET?: string;

  // Phase 4 / T-E2: bucket-key encryption root.
  //
  // BUCKET_KEK_ROOT is the current Key Encryption Key. Per-blob keys are
  // derived from it via HKDF(BUCKET_KEK_ROOT, salt); the salt + a
  // kek_version are stored in each ciphertext header.
  //
  // BUCKET_KEK_VERSION is the integer version that gets stamped into new
  // ciphertext headers. Defaults to 1 when unset.
  //
  // BUCKET_KEK_ROOT_PREVIOUS lets a rotation keep old blobs readable
  // during the dual-read window. Provision as JSON:
  //   `{ "<version-int>": "<hex-encoded-key>", ... }`
  // and rotate by:
  //   1. wrangler secret put BUCKET_KEK_VERSION (e.g. 2)
  //   2. wrangler secret put BUCKET_KEK_ROOT (new key for version 2)
  //   3. wrangler secret put BUCKET_KEK_ROOT_PREVIOUS '{"1":"<old-hex>"}'
  //   4. (lazy re-encrypt or migration script) — see RUNBOOK.
  //
  // Per T-E2 (Codex tension): NEVER derive this from TOKEN_SIGNING_SECRET.
  // Rotating the share-token secret must not invalidate every encrypted
  // blob in the system.
  BUCKET_KEK_ROOT?: string;
  BUCKET_KEK_VERSION?: string;
  BUCKET_KEK_ROOT_PREVIOUS?: string;
}

export interface AgentAuth {
  type: 'agent';
  agent_id: string;
  agent_name?: string;
  org_id?: string;
  agent_platform: import('@agentdrive/shared').AgentPlatform;
  agent_role?: string;
  created_by?: string;
}

export interface ShareAuth {
  type: 'share';
  token_id: string;
  workspace_id: string;
  file_id?: string;
  permission: import('@agentdrive/shared').Permission;
  email?: string;
}

export interface SessionAuth {
  type: 'session';
  session_id: string;
  email: string;
  org_id?: string;
}

export type AuthContext = AgentAuth | ShareAuth | SessionAuth;
