export type Permission = 'view' | 'comment' | 'edit' | 'owner';

export const PERMISSION_LEVELS: Record<Permission, number> = {
  view: 0,
  comment: 1,
  edit: 2,
  owner: 3,
};

export function hasPermission(current: Permission, required: Permission): boolean {
  return PERMISSION_LEVELS[current] >= PERMISSION_LEVELS[required];
}

export interface TokenPayload {
  v: 1;
  tid: string;       // token ID
  wid: string;       // workspace ID
  fid?: string;      // file ID (optional, scopes to single file)
  permission: Permission;
  issuer: string;     // agent ID, "member" (the email is kept off the URL), or "system"
  exp?: number;       // expiry (unix seconds)
  max_uses?: number;  // usage limit
  email?: string;     // if set, requires email verification before access
}

export interface WorkspaceMeta {
  id: string;
  name: string;
  org_id?: string;
  created_at: string;
  created_by: string;
  agent_count: number;
  // Phase 4 BYO-bucket — the workspace's chosen bucket_config. Unset / 'default'
  // both mean "use the AgentDrive R2 bucket." When set to a custom config_id
  // the org owns, new file writes land in that bucket and the file's
  // FileMeta.bucket_config_id captures the assignment at write time.
  bucket_config_id?: string;
}

// Phase 4 (T-E1) storage locator. Recorded on every new file write so
// reads can route to the right bucket even after the org's bucket_config
// switches. Legacy rows written before this lands have these fields
// undefined; readers MUST treat undefined as the default locator
// (provider='agentdrive-r2', bucket_config_id='default',
// object_key='content/<hash>', key_version=1).
export type StorageProvider = 'agentdrive-r2' | 'cf-r2-cross-account' | 's3-hmac';

export interface StorageLocator {
  bucket_config_id?: string;
  provider?: StorageProvider;
  object_key?: string;
  key_version?: number;
}

export const DEFAULT_STORAGE_LOCATOR = {
  bucket_config_id: 'default',
  provider: 'agentdrive-r2' as StorageProvider,
  key_version: 1,
} as const;

// Phase 4 bucket_config — customer-declared BYO bucket. Stored in KV under
// `bucket_config:<org_id>:<config_id>`. POST/PUT writes the full record;
// GET endpoints MUST mask the secret_access_key before returning anything
// over the wire.
export type BucketHealth = 'healthy' | 'degraded' | 'unverified';

export interface BucketConfigMeta {
  id: string;
  org_id: string;
  name: string;
  provider: StorageProvider;
  // s3-compat fields (cf-r2-cross-account + s3-hmac only)
  endpoint?: string;
  region?: string;
  bucket?: string;
  access_key_id?: string;
  // Sensitive. Never returned by GET endpoints.
  secret_access_key?: string;
  health: BucketHealth;
  last_verified_at?: string;
  last_error?: string;
  created_at: string;
  created_by: string;
}

// Public-facing shape that the route returns. Same as BucketConfigMeta
// minus the sensitive secret_access_key (and with access_key_id retained
// since it's not secret on its own — needed to identify the IAM principal).
export type BucketConfigPublic = Omit<BucketConfigMeta, 'secret_access_key'>;

export function maskBucketConfig(meta: BucketConfigMeta): BucketConfigPublic {
  const { secret_access_key: _hidden, ...rest } = meta;
  return rest;
}

export function defaultObjectKey(contentHash: string): string {
  return `content/${contentHash}`;
}

export function resolveLocator(meta: StorageLocator, contentHash: string): Required<StorageLocator> {
  return {
    bucket_config_id: meta.bucket_config_id ?? DEFAULT_STORAGE_LOCATOR.bucket_config_id,
    provider: meta.provider ?? DEFAULT_STORAGE_LOCATOR.provider,
    object_key: meta.object_key ?? defaultObjectKey(contentHash),
    key_version: meta.key_version ?? DEFAULT_STORAGE_LOCATOR.key_version,
  };
}

export interface FileMeta extends StorageLocator {
  id: string;
  workspace_id: string;
  path: string;
  content_hash: string;
  size: number;
  mime_type: string;
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
}

export interface FileVersion extends StorageLocator {
  version: number;
  content_hash: string;
  size: number;
  actor_type: 'agent' | 'human';
  actor_id: string;
  created_at: string;
  message?: string;
}

export interface Comment {
  id: string;
  file_id: string;
  workspace_id: string;
  author_type: 'agent' | 'human';
  author_id: string;
  author_name?: string;
  body: string;
  created_at: string;
  line_start?: number;
  line_end?: number;
}

export type ActivityAction =
  | 'file.write' | 'file.update' | 'file.delete'
  | 'comment.add' | 'share.create' | 'share.revoke' | 'workspace.create'
  | 'role.assign' | 'role.remove'
  | 'member.invite' | 'agent.register';

export type ActivityTarget = 'file' | 'workspace' | 'share' | 'role' | 'member' | 'agent';

export interface ActivityEvent {
  id: string;
  workspace_id: string;
  actor_type: 'agent' | 'human';
  actor_id: string;
  // Phase 3: platform stamped at write time so /v1/org/timeline can render
  // cross-agent activity without a join. Undefined for legacy events.
  agent_platform?: string;
  action: ActivityAction;
  target_type: ActivityTarget;
  target_id: string;
  target_path?: string;
  metadata?: Record<string, string>;
  created_at: string;
}

export interface ShareTokenMeta {
  token_id: string;
  workspace_id: string;
  file_id?: string;
  permission: Permission;
  issuer: string;     // agent ID, member:<email>, or "system"
  created_at: string;
  expires_at?: string;
  max_uses?: number;
  use_count: number;
  revoked: boolean;
  email?: string;       // email-gated: only this email can use the token
}

export interface ApiKeyMeta {
  agent_id: string;
  agent_name?: string;
  org_id?: string;
  created_at: string;
  last_used_at?: string;
  // Set on keys minted through the management flow (register + /v1/keys) so
  // they can be listed and revoked by key_id. Keys predating this are still
  // valid for auth but won't appear in /v1/keys until re-minted.
  key_id?: string;
  name?: string;
  prefix?: string;
  // Lowercased email of the org member the key acts for, inherited by keys it
  // mints, so removing that member revokes them. Absent on the founding agent's
  // /v1/register key, keys it mints, and keys minted before this field existed.
  created_by?: string;
  // Agent id of the API key that created this one; that key may revoke it.
  minted_by?: string;
  // OAuth client the key was minted for at hosted-MCP consent. Only such keys are
  // swept when no live grant holds them any more.
  oauth_client_id?: string;
}

// Listing/management view of a key — never carries the secret. Returned by
// GET /v1/keys; the raw secret is only ever returned once at POST /v1/keys.
export interface ApiKeyRecord {
  key_id: string;
  org_id: string;
  agent_id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export type Paginated<T> = { items: T[]; cursor: string | null };

// --- Plans & Billing ---

export type Plan = 'trial' | 'starter' | 'pro' | 'team';

export const PAID_PLANS = ['pro', 'team'] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

// Team is billed per seat; checkout's quantity is the org's seat cap.
export const TEAM_SEATS = { min: 3, max: 100 } as const;

export interface PlanQuota {
  storage_bytes: number;
  embedding_count: number;
  max_agents: number;
  max_workspaces: number;
  max_human_seats: number;
  max_file_size: number;
  // Distinct sessions resumed in another harness per calendar month (UTC); null is unlimited.
  max_resumes_month: number | null;
}

export const PLAN_QUOTAS: Record<Plan, PlanQuota> = {
  trial:    { storage_bytes: 1024 * 1024 * 1024,        embedding_count: 10_000,     max_agents: 3,   max_workspaces: 1,    max_human_seats: 1,  max_file_size: 5 * 1024 * 1024,   max_resumes_month: 10 },
  starter:  { storage_bytes: 1024 * 1024 * 1024,        embedding_count: 10_000,     max_agents: 3,   max_workspaces: 1,    max_human_seats: 1,  max_file_size: 5 * 1024 * 1024,   max_resumes_month: 10 },
  pro:      { storage_bytes: 50 * 1024 * 1024 * 1024,   embedding_count: 1_000_000,  max_agents: 25,  max_workspaces: 500,  max_human_seats: 1,  max_file_size: 50 * 1024 * 1024,  max_resumes_month: null },
  team:     { storage_bytes: 250 * 1024 * 1024 * 1024,  embedding_count: 10_000_000, max_agents: 100, max_workspaces: 1000, max_human_seats: TEAM_SEATS.min, max_file_size: 100 * 1024 * 1024, max_resumes_month: null },
};

// Public plan catalog: every pricing surface (site, app, docs) renders from
// this, and limit bullets are derived from PLAN_QUOTAS so copy can't drift
// from what the worker enforces. Stripe holds the charged amounts; keep
// `price` in step with the Stripe prices when either changes.
export type CatalogPlanId = 'free' | PaidPlan | 'enterprise';

export interface CatalogPlan {
  id: CatalogPlanId;
  name: string;
  price: string;
  cadence: string;
  blurb: string;
  features: string[];
}

const gb = (bytes: number) => `${bytes / 1024 ** 3} GB`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function quotaFeatures(q: PlanQuota, seats = plural(q.max_human_seats, 'principal')): string[] {
  return [
    seats,
    `${gb(q.storage_bytes)} storage (soft limit)`,
    plural(q.max_workspaces, 'workspace'),
    plural(q.max_agents, 'agent'),
    q.max_resumes_month === null ? 'Unlimited cross-agent resumes' : `${q.max_resumes_month} cross-agent resumes a month`,
  ];
}

export const ALL_PLANS_INCLUDE: string[] = [
  'Session sync and resume across Claude Code, Codex, OpenCode, Cursor and Antigravity',
  'Versioned, content-addressed workspace',
  "Semantic search across every agent's work",
  'Provenance timeline: which agent did what, on which artifact',
  'Private Workspace with client-side encryption',
  'MCP server, CLI and TypeScript SDK',
  '$0 egress',
];

export const PLAN_CATALOG: CatalogPlan[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    cadence: 'forever',
    blurb: 'The whole loop on one machine.',
    features: [...quotaFeatures(PLAN_QUOTAS.trial), 'Unlimited local resumes on one machine, no account needed'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$20',
    cadence: 'per month',
    blurb: 'One developer running several agents every day, with every session kept.',
    features: [...quotaFeatures(PLAN_QUOTAS.pro), 'Email support'],
  },
  {
    id: 'team',
    name: 'Team',
    price: '$30',
    cadence: `per seat / month, ${TEAM_SEATS.min}-seat minimum`,
    blurb: 'A team handing work between people and agents, priced per seat.',
    features: [
      ...quotaFeatures(PLAN_QUOTAS.team, `${TEAM_SEATS.min} to ${TEAM_SEATS.max} seats`),
      'Workspace roles and invites',
      'Bring your own bucket (R2 or S3)',
      'Priority support',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    cadence: 'annual contract',
    blurb: 'Custom limits, security review and a DPA.',
    features: [
      'Everything in Team',
      'Custom limits and volume pricing',
      'Security review and DPA',
      'Dedicated support channel',
    ],
  },
];

export const COMING_NEXT: string[] = [
  'SSO / SAML',
  'Audit-log export',
  'Customer-managed keys',
  'GCS and Azure buckets',
];

export function catalogIdForPlan(plan: Plan): CatalogPlanId {
  return plan === 'pro' || plan === 'team' ? plan : 'free';
}

// --- Organization ---

export interface OrgMeta {
  id: string;
  name: string;
  plan: Plan;
  created_at: string;
  created_by: string;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  // Team seats bought, from the subscription item's quantity.
  seats?: number;
  trial_ends_at?: string;
}

export interface OrgMember {
  org_id: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  joined_at: string;
  invited_by: string;
}

export interface OrgInvite {
  org_id: string;
  org_name: string;
  email: string;
  role: OrgMember['role'];
  invited_by: string;
  created_at: string;
  expires_at: string;
}

export interface OrgAgent {
  org_id: string;
  agent_id: string;
  agent_name?: string;
  agent_email?: string;
  joined_at: string;
  // Set when the agent's key is revoked. The record stays so the agent still
  // counts as the org's, but its role grants and share links stop working.
  revoked_at?: string;
}

// --- Sessions (human identity) ---

export interface SessionMeta {
  session_id: string;
  email: string;
  org_id?: string;
  created_at: string;
  expires_at: string;
  last_active_at: string;
}

// --- Role Delegation ---

export interface RoleAssignment {
  workspace_id: string;
  email: string;
  permission: Permission;
  assigned_by: string;
  assigned_at: string;
  // Set when an email-gated share link created the role; revoking that link removes it.
  granted_via?: string;
}

// --- Agent Registration ---

export interface AgentRegistration {
  agent_id: string;
  api_key: string;
  org_id: string;
  agent_email?: string;
  agent_claim_url?: string;
}

// --- Cross-agent identity ---

export type AgentPlatform =
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'langgraph'
  | 'crewai'
  | 'autogen'
  | 'hermes'
  | 'openclaw'
  | 'opencode'
  | 'gemini-cli'
  | 'antigravity'
  | 'unknown';

export const AGENT_PLATFORMS: readonly AgentPlatform[] = [
  'claude-code',
  'codex',
  'cursor',
  'langgraph',
  'crewai',
  'autogen',
  'hermes',
  'openclaw',
  'opencode',
  'gemini-cli',
  'antigravity',
  'unknown',
] as const;

export type RunStatus = 'success' | 'failure' | 'partial' | 'in_progress';

export interface AgentRun {
  run_id: string;
  org_id: string;
  workspace_id?: string;
  agent_id: string;
  agent_platform: AgentPlatform;
  agent_role?: string;
  task: string;
  artifacts_referenced: string[];
  artifacts_produced: string[];
  duration_ms?: number;
  status: RunStatus;
  metadata: Record<string, unknown>;
  // Capped at 100 entries by the API; summaries truncated to 500 chars each.
  tool_calls?: ToolCall[];
  created_at: number;
  updated_at?: number;
}

// Placeholder for v1.5 fact extraction
export interface Fact {
  fact_id: string;
  org_id: string;
  workspace_id?: string;
  kind: string;
  body: string;
  source_path?: string;
  source_content_hash?: string;
  agent_id: string;
  agent_platform: AgentPlatform;
  created_at: number;
}

export type MatchKind = 'semantic' | 'keyword';

export interface RetrievalResult {
  path: string;
  ws_id: string;
  content_hash: string;
  // null when the hit comes from the keyword fallback (Vectorize returned 0).
  score: number | null;
  snippet?: string;
  agent_id: string;
  agent_platform: AgentPlatform;
  created_at: number;
  chunk_idx?: number;
  match_kind?: MatchKind;
}

export interface SearchFilter {
  agent_platform?: AgentPlatform;
  agent_id?: string;
  path_prefix?: string;
}

export interface SearchRequest {
  workspace_id?: string;
  query: string;
  top_k?: number;
  filter?: SearchFilter;
}

export interface SearchResponse {
  success: true;
  data: {
    hits: RetrievalResult[];
    total: number;
  };
}

export interface ContextRequest {
  workspace_id?: string;
  task: string;
  limit?: number;
}

export interface ContextArtifactAttribution {
  // Why this artifact was surfaced. All sub-scores are in [0, 1].
  semantic_score: number;
  recency_score: number;
  // Final score after the semantic/recency blend AND the diversity penalty.
  blended_score: number;
  // 0 when the artifact was kept at its natural rank, negative when a
  // platform-diversity penalty bumped it down to surface a different agent.
  diversity_penalty?: number;
  reasons: string[];
}

export interface ContextArtifactRunSummary {
  run_id: string;
  task: string;
  status: string;
  created_at: number;
  agent_id: string;
  agent_platform: string;
}

export interface ContextArtifact extends RetrievalResult {
  // Context route may return a longer snippet (up to 500 chars) than search hits.
  snippet?: string;
  // Phase 1 (drive_context excellence pass): per-artifact "why" attribution
  // and the most recent run that referenced this artifact.
  attribution?: ContextArtifactAttribution;
  last_run?: ContextArtifactRunSummary;
}

export interface ContextResponse {
  success: true;
  data: {
    artifacts: ContextArtifact[];
    retrieved_at: number;
  };
}

// --- OAuth + CLI Auth (Wave 3) ---

export type OAuthProvider = 'google' | 'github';

export const OAUTH_PROVIDERS: readonly OAuthProvider[] = ['google', 'github'] as const;

export interface ProviderLinkedUser {
  org_id: string;
  email: string;
  provider: OAuthProvider;
  provider_sub: string;
  linked_at: string;
}

// 'expired' is never stored: a pending record past expires_at reads as expired.
// 'denied' means too many wrong user codes were entered for it.
export type CliPendingStatus = 'pending' | 'complete' | 'expired' | 'refused' | 'denied';

export interface CliPendingRecord {
  id: string;
  status: CliPendingStatus;
  created_at: number;
  expires_at: number;
  // SHA-256 of `<id>:<user code>`. The code is shown only in the terminal that started the login.
  user_code_hash: string;
  // SHA-256 of the device code, the poll secret that only the CLI holds; the id is in the browser URL.
  device_code_hash: string;
  failed_attempts: number;
  // Unix seconds of the first poll that returned the key; the record then lives one more minute.
  delivered_at?: number;
  agent_id?: string;
  org_id?: string;
  email?: string;
  api_key?: string;
  error?: string;
  upgrade_url?: string;
}

export interface OAuthStatePayload {
  // Also the value of the browser's state cookie, which ties the callback to that browser.
  nonce: string;
  provider: OAuthProvider;
  // Where the sign-in started; the state cookie lives on that host only.
  origin: string;
  redirect_after?: string;
  exp: number;
}

// --- Sandbox (Wave 5 Stream D) ---

export interface SandboxState {
  workspace_id: string;
  repo_url?: string;
  branch?: string;
  head_sha?: string;
  last_active_at?: number;
}

export interface SandboxExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  truncated: boolean;
}

export interface SandboxCommitResult {
  commit_sha: string;
  branch: string;
  files_changed: number;
  artifact_path: string;
}

export type ToolCallStatus = 'success' | 'failure' | 'partial' | 'pending';

export interface ToolCall {
  tool: string;
  args_summary?: string;
  result_summary?: string;
  status: ToolCallStatus;
  duration_ms?: number;
  time_offset_ms: number;
}

export interface RunRequest {
  run_id?: string;
  workspace_id?: string;
  task: string;
  artifacts_referenced?: string[];
  artifacts_produced?: string[];
  duration_ms?: number;
  status: RunStatus;
  metadata?: Record<string, unknown>;
  tool_calls?: ToolCall[];
}

export interface RunResponse {
  success: true;
  data: {
    run_id: string;
    created_at: number;
  };
}
