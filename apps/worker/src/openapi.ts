import { z } from 'zod';
import { AGENT_PLATFORMS } from '@agentdrive/shared';
import type {
  ActivityEvent, AgentPlatform, AgentRun, ApiKeyRecord, BucketConfigPublic, Comment, ContextArtifact, FileMeta,
  FileVersion, OrgAgent, OrgInvite, OrgMember, OrgMeta, PlanQuota, RetrievalResult, RoleAssignment,
  SandboxCommitResult, SandboxExecResult, SandboxState, ShareTokenMeta, ToolCall, WorkspaceMeta,
} from '@agentdrive/shared';
import type { PlanLimitBody, UsageStatus, UsageWarning } from './services/limits.js';
import type { Usage } from './services/storage.js';
import type { StorageChecks } from './services/health.js';
import { writeSchema, updateSchema } from './routes/files.js';
import { createSchema as createWorkspaceSchema, assignSchema } from './routes/workspaces.js';
import { commentSchema } from './routes/comments.js';
import { roleSchema } from './routes/roles.js';
import { shareSchema } from './routes/shares.js';
import { searchSchema } from './routes/search.js';
import { contextSchema } from './routes/context.js';
import { runSchema, toolCallSchema, projectQuerySchema } from './routes/runs.js';
import { querySchema as timelineQuerySchema } from './routes/timeline.js';
import { createSchema as createBucketConfigSchema } from './routes/bucket-config.js';
import { cloneSchema, execSchema, commitSchema } from './routes/sandbox.js';
import { renameSchema, inviteSchema } from './routes/orgs.js';
import { createKeySchema } from './routes/keys.js';
import { checkoutSchema } from './routes/billing.js';
import { sendCodeSchema, verifyCodeSchema } from './routes/auth.js';
import { registerSchema } from './routes/register.js';
import { startSchema, pollSchema, completeSchema } from './routes/cli-auth.js';
import { LIMITERS, rateLimitPolicy, type Kind } from './middleware/rate-limit.js';
import { supportsIdempotency, MAX_STORED_RESPONSE_BYTES } from './middleware/idempotency.js';
import { DEFAULT_ERROR_CODES } from './app.js';

// The OpenAPI 3.1 contract for the /v1 REST API, published at agentdrive.sh/openapi.json.
// Request bodies are the routes' own Zod schemas; response schemas are checked against
// the shared types at compile time; test/openapi.test.ts holds the operations to app.routes
// and the committed apps/worker/openapi.json to this output.

const registry = z.registry<{ id: string }>();
const ids = new Set<string>();

function component<S extends z.ZodType>(id: string, schema: S): S {
  if (ids.has(id)) throw new Error(`Duplicate OpenAPI component ${id}`);
  ids.add(id);
  registry.add(schema, { id });
  return schema;
}

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// Fails to compile when the schema's type and T differ in either direction. Comparing
// the keys too catches an optional field present on one side only.
type Exact<A, B> = Same<A, B> extends true ? Same<keyof A, keyof B> : false;
const typed = <T>() => <S extends z.ZodType>(schema: S, ..._exact: Exact<z.output<S>, T> extends true ? [] : [never]) => schema;

const iso = z.string().describe('ISO 8601 timestamp');
const epochMs = z.number().describe('Unix time in milliseconds');
const cursor = z.string().nullable().describe('Pass as ?cursor= for the next page; null when there are no more.');

const agentPlatform = component('AgentPlatform', z.enum(AGENT_PLATFORMS as readonly [AgentPlatform, ...AgentPlatform[]]));
const permission = component('Permission', z.enum(['view', 'comment', 'edit', 'owner']).describe('Ordered view < comment < edit < owner.'));
const storageProvider = z.enum(['agentdrive-r2', 'cf-r2-cross-account', 's3-hmac']);
const actorType = z.enum(['agent', 'human']);

const storageLocator = {
  bucket_config_id: z.string().optional(),
  provider: storageProvider.optional(),
  object_key: z.string().optional(),
  key_version: z.number().optional(),
};

const errorBody = component('Error', z.object({
  success: z.literal(false),
  code: z.string().describe(`Machine-readable code. Routes set specific ones (e.g. rate_limited, plan_limit, idempotency_key_reused); otherwise it is the status default: ${
    Object.entries(DEFAULT_ERROR_CODES).map(([status, code]) => `${status} ${code}`).join(', ')}.`),
  error: z.string().describe('Human-readable message.'),
}).describe('Every 4xx and 5xx body. Some carry extra fields; the subtypes that declare them are allOf this schema.'));

const usageMetric = z.enum(['storage_bytes', 'embedding_count', 'agent_count', 'workspace_count', 'member_count', 'resume_count']);
const usageLevel = z.enum(['ok', 'warn80', 'warn90', 'warn99', 'paused']);
const plan = z.enum(['trial', 'starter', 'pro', 'team']);

const planLimit = component('PlanLimitError', typed<PlanLimitBody>()(errorBody.and(z.object({
  code: z.literal('plan_limit'),
  metric: usageMetric,
  used: z.number(),
  limit: z.number(),
  plan,
  upgrade_url: z.string(),
}))));

const usageWarning = component('UsageWarning', typed<UsageWarning>()(z.object({
  metric: usageMetric,
  level: usageLevel,
  message: z.string(),
  upgrade_url: z.string(),
}).describe('Present when the org is at 80% or more of a plan limit.')));

const usage = component('Usage', typed<Usage>()(z.object({
  storage_bytes: z.number(),
  embedding_count: z.number(),
  agent_count: z.number(),
  workspace_count: z.number(),
  member_count: z.number(),
})));

const planQuota = component('PlanQuota', typed<PlanQuota>()(z.object({
  storage_bytes: z.number(),
  embedding_count: z.number(),
  max_agents: z.number(),
  max_workspaces: z.number(),
  max_human_seats: z.number(),
  max_file_size: z.number(),
  max_resumes_month: z.number().nullable().describe('null is unlimited.'),
})));

const metricStatus = z.object({ used: z.number(), limit: z.number(), pct: z.number(), level: usageLevel });

const usageStatus = component('UsageStatus', typed<UsageStatus>()(z.object({
  plan,
  plan_name: z.string(),
  level: usageLevel,
  metric: usageMetric.optional(),
  message: z.string().optional(),
  metrics: z.object({
    storage_bytes: metricStatus,
    embedding_count: metricStatus,
    agent_count: metricStatus,
    workspace_count: metricStatus,
    member_count: metricStatus,
    resume_count: metricStatus.optional(),
  }),
  next_plan: z.enum(['free', 'pro', 'team', 'enterprise']),
  upgrade_url: z.string(),
})));

const workspace = component('Workspace', typed<WorkspaceMeta>()(z.object({
  id: z.string(),
  name: z.string(),
  org_id: z.string().optional(),
  created_at: iso,
  created_by: z.string(),
  agent_count: z.number(),
  bucket_config_id: z.string().optional(),
})));

const file = component('File', typed<FileMeta>()(z.object({
  ...storageLocator,
  id: z.string(),
  workspace_id: z.string(),
  path: z.string(),
  content_hash: z.string().describe('SHA-256 of the content.'),
  size: z.number(),
  mime_type: z.string(),
  version: z.number(),
  created_at: iso,
  updated_at: iso,
  created_by: z.string(),
  updated_by: z.string(),
  updated_by_platform: agentPlatform.optional(),
})));

const fileWithContent = component('FileWithContent', file.extend({
  content: z.string().nullable().describe('null when the stored bytes cannot be read.'),
}));

const fileVersion = component('FileVersion', typed<FileVersion>()(z.object({
  ...storageLocator,
  version: z.number(),
  content_hash: z.string(),
  size: z.number(),
  actor_type: actorType,
  actor_id: z.string(),
  created_at: iso,
  message: z.string().optional(),
})));

const comment = component('Comment', typed<Comment>()(z.object({
  id: z.string(),
  file_id: z.string(),
  workspace_id: z.string(),
  author_type: actorType,
  author_id: z.string(),
  author_name: z.string().optional(),
  body: z.string(),
  created_at: iso,
  line_start: z.number().optional(),
  line_end: z.number().optional(),
})));

const activityEvent = component('ActivityEvent', typed<ActivityEvent>()(z.object({
  id: z.string(),
  workspace_id: z.string(),
  actor_type: actorType,
  actor_id: z.string(),
  agent_platform: z.string().optional(),
  action: z.enum([
    'file.write', 'file.update', 'file.delete', 'comment.add', 'share.create', 'share.revoke', 'workspace.create',
    'role.assign', 'role.remove', 'member.invite', 'agent.register',
  ]),
  target_type: z.enum(['file', 'workspace', 'share', 'role', 'member', 'agent']),
  target_id: z.string(),
  target_path: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  created_at: iso,
})));

const shareLink = component('ShareLink', typed<ShareTokenMeta>()(z.object({
  token_id: z.string(),
  workspace_id: z.string(),
  file_id: z.string().optional(),
  permission,
  issuer: z.string(),
  created_at: iso,
  expires_at: iso.optional(),
  max_uses: z.number().optional(),
  use_count: z.number(),
  revoked: z.boolean(),
  email: z.string().optional(),
})));

const roleAssignment = component('RoleAssignment', typed<RoleAssignment>()(z.object({
  workspace_id: z.string(),
  email: z.string(),
  permission,
  assigned_by: z.string(),
  assigned_at: iso,
  granted_via: z.string().optional().describe('Share link id when an email-gated link created the role.'),
})));

const apiKey = component('ApiKey', typed<ApiKeyRecord>()(z.object({
  key_id: z.string(),
  org_id: z.string(),
  agent_id: z.string(),
  name: z.string(),
  prefix: z.string().describe('First and last characters of the key, for recognising it.'),
  created_at: iso,
  last_used_at: iso.optional(),
})));

const org = component('Org', typed<OrgMeta>()(z.object({
  id: z.string(),
  name: z.string(),
  plan,
  created_at: iso,
  created_by: z.string(),
  stripe_customer_id: z.string().optional(),
  stripe_subscription_id: z.string().optional(),
  seats: z.number().optional(),
  trial_ends_at: iso.optional(),
})));

const orgRole = z.enum(['owner', 'admin', 'member']);

const orgMember = component('OrgMember', typed<OrgMember>()(z.object({
  org_id: z.string(),
  email: z.string(),
  role: orgRole,
  joined_at: iso,
  invited_by: z.string(),
})));

const orgInvite = component('OrgInvite', typed<OrgInvite>()(z.object({
  org_id: z.string(),
  org_name: z.string(),
  email: z.string(),
  role: orgRole,
  invited_by: z.string(),
  created_at: iso,
  expires_at: iso,
})));

const orgAgent = component('OrgAgent', typed<OrgAgent>()(z.object({
  org_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string().optional(),
  agent_email: z.string().optional(),
  joined_at: iso,
  revoked_at: iso.optional(),
})));

const toolCall = typed<ToolCall>()(z.object({
  tool: z.string(),
  args_summary: z.string().optional(),
  result_summary: z.string().optional(),
  status: z.enum(['success', 'failure', 'partial', 'pending']),
  duration_ms: z.number().optional(),
  time_offset_ms: z.number(),
}));

const runStatus = z.enum(['success', 'failure', 'partial', 'in_progress']);

const agentRun = component('AgentRun', typed<AgentRun>()(z.object({
  run_id: z.string(),
  org_id: z.string(),
  workspace_id: z.string().optional(),
  agent_id: z.string(),
  agent_platform: agentPlatform,
  agent_role: z.string().optional(),
  task: z.string(),
  artifacts_referenced: z.array(z.string()),
  artifacts_produced: z.array(z.string()),
  duration_ms: z.number().optional(),
  status: runStatus,
  metadata: z.record(z.string(), z.unknown()),
  tool_calls: z.array(toolCall).optional(),
  created_at: epochMs,
  updated_at: epochMs.optional(),
})));

const searchHitShape = {
  path: z.string(),
  ws_id: z.string(),
  content_hash: z.string(),
  score: z.number().nullable().describe('null for a keyword-fallback hit.'),
  snippet: z.string().optional(),
  agent_id: z.string(),
  agent_platform: agentPlatform,
  created_at: epochMs,
  chunk_idx: z.number().optional(),
  match_kind: z.enum(['semantic', 'keyword']).optional(),
};

const searchHit = component('SearchHit', typed<RetrievalResult>()(z.object(searchHitShape)));

const contextArtifact = component('ContextArtifact', typed<ContextArtifact>()(z.object({
  ...searchHitShape,
  attribution: z.object({
    semantic_score: z.number(),
    recency_score: z.number(),
    blended_score: z.number(),
    diversity_penalty: z.number().optional(),
    reasons: z.array(z.string()),
  }).optional().describe('Why the artifact was surfaced.'),
  last_run: z.object({
    run_id: z.string(),
    task: z.string(),
    status: z.string(),
    created_at: epochMs,
    agent_id: z.string(),
    agent_platform: z.string(),
  }).optional().describe('The most recent run that referenced the artifact.'),
})));

const bucketConfig = component('BucketConfig', typed<BucketConfigPublic>()(z.object({
  id: z.string(),
  org_id: z.string(),
  name: z.string(),
  provider: storageProvider,
  endpoint: z.string().optional(),
  region: z.string().optional(),
  bucket: z.string().optional(),
  access_key_id: z.string().optional(),
  health: z.enum(['healthy', 'degraded', 'unverified']),
  last_verified_at: iso.optional(),
  last_error: z.string().optional(),
  created_at: iso,
  created_by: z.string(),
}).describe('A bring-your-own bucket. The secret access key is never returned.')));

const sandboxState = component('SandboxState', typed<SandboxState>()(z.object({
  workspace_id: z.string(),
  repo_url: z.string().optional(),
  branch: z.string().optional(),
  head_sha: z.string().optional(),
  last_active_at: z.number().optional().describe('Unix time in seconds'),
})));

const sandboxExecResult = component('SandboxExecResult', typed<SandboxExecResult>()(z.object({
  exit_code: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  duration_ms: z.number(),
  truncated: z.boolean(),
})));

const sandboxCommitResult = component('SandboxCommitResult', typed<SandboxCommitResult>()(z.object({
  commit_sha: z.string(),
  branch: z.string(),
  files_changed: z.number(),
  artifact_path: z.string().describe('Workspace path of the commit record written for other agents.'),
})));

const ok = <S extends z.ZodType>(id: string, data: S, extra: z.ZodRawShape = {}) =>
  component(id, z.object({ success: z.literal(true), data, ...extra }));
const page = <S extends z.ZodType>(id: string, item: S) => ok(id, z.array(item), { cursor });
const flag = (id: string, key: string) => ok(id, z.object({ [key]: z.literal(true) }));
const warning = { usage_warning: usageWarning.optional() };

const requestBodies = {
  WriteFileRequest: writeSchema,
  UpdateFileRequest: updateSchema,
  CreateWorkspaceRequest: createWorkspaceSchema,
  AssignBucketConfigRequest: assignSchema,
  CreateCommentRequest: commentSchema,
  AssignRoleRequest: roleSchema,
  CreateShareRequest: shareSchema,
  SearchRequest: searchSchema,
  ContextRequest: contextSchema,
  RunRequest: runSchema,
  CreateBucketConfigRequest: createBucketConfigSchema,
  SandboxCloneRequest: cloneSchema,
  SandboxExecRequest: execSchema,
  SandboxCommitRequest: commitSchema,
  RenameOrgRequest: renameSchema,
  InviteRequest: inviteSchema,
  CreateKeyRequest: createKeySchema,
  CheckoutRequest: checkoutSchema,
  SendCodeRequest: sendCodeSchema,
  VerifyCodeRequest: verifyCodeSchema,
  RegisterRequest: registerSchema,
  CliStartRequest: startSchema,
  CliPollRequest: pollSchema,
  CliCompleteRequest: completeSchema,
};
for (const [id, schema] of Object.entries(requestBodies)) component(id, schema);
component('ToolCallInput', toolCallSchema);

type Principal = 'apiKey' | 'session' | 'share';
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
type ErrorStatus = 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500 | 501 | 502 | 503;
type Header = 'platform' | 'role' | 'bootstrap';

interface QueryParam {
  schema: z.ZodType;
  description: string;
  required?: boolean;
}

interface Operation {
  method: Method;
  path: string;
  operationId: string;
  tag: string;
  summary: string;
  description: string;
  auth: Principal[];
  body?: keyof typeof requestBodies;
  query?: Record<string, QueryParam>;
  headers?: Header[];
  // Limiters besides the per-principal one every authenticated operation passes.
  limits?: Exclude<Kind, 'principal'>[];
  ok: Partial<Record<200 | 201 | 503, { schema: z.ZodType; description: string }>>;
  errors: ErrorStatus[];
}

const ANY: Principal[] = ['apiKey', 'session', 'share'];
const ORG: Principal[] = ['apiKey', 'session'];
const PROVENANCE: Header[] = ['platform'];

const cursorQuery: Record<string, QueryParam> = {
  cursor: { schema: z.string(), description: 'Cursor from the previous page.' },
};

const deleted = flag('DeletedResponse', 'deleted');
const revoked = flag('RevokedResponse', 'revoked');
const workspaceResponse = ok('WorkspaceResponse', workspace);
const fileResponse = ok('FileResponse', file, warning);
const runPage = page('RunPage', agentRun);
const runResponse = ok('RunResponse', z.object({ run_id: z.string(), created_at: epochMs, updated_at: epochMs }), warning);
const bucketConfigResponse = ok('BucketConfigResponse', bucketConfig);
const healthResponse = component('HealthResponse', typed<{ status: 'ok' | 'unavailable'; version: string; checks: StorageChecks }>()(z.object({
  status: z.enum(['ok', 'unavailable']),
  version: z.string(),
  checks: z.object({ kv: z.enum(['ok', 'unavailable']), r2: z.enum(['ok', 'unavailable']) }),
})));
const healthUnavailable = component('HealthUnavailable', errorBody.and(healthResponse).describe('code is storage_unavailable.'));

const operations: Operation[] = [
  {
    method: 'get', path: '/v1/health', operationId: 'getHealth', tag: 'Meta',
    summary: 'Check service health',
    description: 'Reports whether KV and R2 answer reads, with the deployed version. Needs no authentication. Answers 503 when either store is unavailable, with the same fields plus the error ones.',
    auth: [],
    ok: {
      200: { schema: healthResponse, description: 'Both stores answered.' },
      503: { schema: healthUnavailable, description: 'A store is unavailable.' },
    },
    errors: [],
  },
  {
    method: 'post', path: '/v1/register', operationId: 'registerAgent', tag: 'Registration',
    summary: 'Register an agent and create its org',
    description: 'Creates a new org on the trial plan and its first agent, and returns that agent\'s API key. The key is shown only in this response. Needs no authentication; rate-limited per IP. On a self-hosted instance it needs X-Bootstrap-Token.',
    limits: ['ip_register'],
    auth: [],
    body: 'RegisterRequest',
    headers: ['bootstrap'],
    ok: { 201: { schema: ok('RegisterResponse', z.object({
      agent_id: z.string(),
      api_key: z.string().describe('agentdrive_live_... Shown once.'),
      org_id: z.string(),
      org_name: z.string(),
      plan: z.literal('trial'),
      trial_ends_at: iso.optional(),
      agent_email: z.string().optional(),
      agent_claim_url: z.string().optional(),
    })), description: 'Agent registered.' } },
    errors: [400, 403, 429],
  },
  {
    method: 'get', path: '/v1/auth/providers', operationId: 'listSignInProviders', tag: 'Auth',
    summary: 'List sign-in providers',
    description: 'Says which human sign-in methods this instance has configured. Needs no authentication.',
    auth: [],
    ok: { 200: { schema: ok('ProvidersResponse', z.object({ google: z.boolean(), github: z.boolean(), email: z.literal(true) })), description: 'Configured providers.' } },
    errors: [],
  },
  {
    method: 'post', path: '/v1/auth/send-code', operationId: 'sendSignInCode', tag: 'Auth',
    summary: 'Email a sign-in code',
    description: 'Emails a 6-digit sign-in code. While a code is live, a resend repeats it. At most 5 codes an hour per address (429 rate_limited); after 5 wrong codes the address is locked for 15 minutes (429 too_many_attempts). Both 429s carry Retry-After. Needs no authentication; rate-limited per IP. Disabled (501) on a self-hosted instance.',
    limits: ['ip_magic'],
    auth: [],
    body: 'SendCodeRequest',
    ok: { 200: { schema: ok('MessageResponse', z.object({ message: z.string() })), description: 'Code sent.' } },
    errors: [400, 429, 501, 502],
  },
  {
    method: 'post', path: '/v1/auth/verify-code', operationId: 'verifySignInCode', tag: 'Auth',
    summary: 'Exchange a sign-in code for a session',
    description: 'Checks the emailed code and returns a session. Send the session_id as X-Session-Token on later requests. Creates an org for the email if it has none. 5 wrong codes lock the address for 15 minutes (429 too_many_attempts with Retry-After). Needs no authentication; rate-limited per IP. Disabled (501) on a self-hosted instance.',
    limits: ['ip_magic'],
    auth: [],
    body: 'VerifyCodeRequest',
    ok: { 200: { schema: ok('SessionResponse', z.object({
      session_id: z.string().describe('Send as X-Session-Token.'),
      email: z.string(),
      org_id: z.string().optional(),
      expires_at: iso,
      context: z.object({ workspace_id: z.string().optional(), token_id: z.string().optional() }).optional()
        .describe('The workspace_id and token_id sent with send-code, if any.'),
    })), description: 'Signed in.' } },
    errors: [400, 401, 429, 501],
  },
  {
    method: 'get', path: '/v1/auth/me', operationId: 'getCurrentPrincipal', tag: 'Auth',
    summary: 'Describe the calling principal',
    description: 'Returns who the credentials on this request belong to: a session (with its org), an agent API key, or a share link.',
    auth: ANY,
    ok: { 200: { schema: ok('PrincipalResponse', z.discriminatedUnion('type', [
      z.object({ type: z.literal('session'), email: z.string(), org_id: z.string().optional(), org: org.nullable() }),
      z.object({ type: z.literal('agent'), agent_id: z.string(), agent_name: z.string().optional(), org_id: z.string().optional() }),
      z.object({ type: z.literal('share'), token_id: z.string(), permission }),
    ])), description: 'The principal.' } },
    errors: [401, 429],
  },
  {
    method: 'post', path: '/v1/auth/logout', operationId: 'logout', tag: 'Auth',
    summary: 'End the session',
    description: 'Deletes the session sent in X-Session-Token. Answers 400 for any other kind of credential.',
    auth: ['session'],
    ok: { 200: { schema: ok('LogoutResponse', z.object({ message: z.string() })), description: 'Logged out.' } },
    errors: [400, 401, 429],
  },
  {
    method: 'post', path: '/v1/auth/cli/start', operationId: 'startCliSignIn', tag: 'Auth',
    summary: 'Start a CLI browser sign-in',
    description: 'Starts a device-style sign-in. Show user_code in the terminal, open auth_url in a browser, then poll /v1/auth/cli/poll with id and device_code. A body without shows_user_code: true answers 400 cli_outdated. Needs no authentication; rate-limited per IP. Not available (501) on a self-hosted instance.',
    limits: ['ip_magic'],
    auth: [],
    body: 'CliStartRequest',
    ok: { 201: { schema: ok('CliStartResponse', z.object({
      id: z.string(),
      auth_url: z.string(),
      user_code: z.string().describe('Show to the user; they type it in the browser.'),
      device_code: z.string().describe('Secret the CLI keeps and polls with.'),
      expires_in: z.number().describe('Seconds until the sign-in expires.'),
    })), description: 'Sign-in started.' } },
    errors: [400, 429, 501],
  },
  {
    method: 'post', path: '/v1/auth/cli/poll', operationId: 'pollCliSignIn', tag: 'Auth',
    summary: 'Poll a CLI sign-in',
    description: 'Reports the state of a CLI sign-in. When status is complete the response carries the new API key once. refused carries the plan-limit error and upgrade link; denied means too many wrong user codes. Needs no authentication.',
    auth: [],
    body: 'CliPollRequest',
    ok: { 200: { schema: ok('CliPollResponse', z.object({
      status: z.enum(['pending', 'complete', 'expired', 'refused', 'denied']),
      error: z.string().optional(),
      upgrade_url: z.string().optional(),
      agent_id: z.string().optional(),
      org_id: z.string().optional(),
      email: z.string().optional(),
      api_key: z.string().optional().describe('Present when status is complete.'),
    })), description: 'Current state.' } },
    errors: [400],
  },
  {
    method: 'post', path: '/v1/auth/cli/complete', operationId: 'completeCliSignIn', tag: 'Auth',
    summary: 'Approve a CLI sign-in',
    description: 'Called by the signed-in browser with the user code shown in the terminal. Mints an API key for the CLI. Wrong codes answer 400 wrong_code; too many end the sign-in (403 denied). Session only; rate-limited per IP.',
    limits: ['ip_magic'],
    auth: ['session'],
    body: 'CliCompleteRequest',
    ok: { 200: { schema: ok('CliCompleteResponse', z.object({ status: z.literal('complete') })), description: 'Sign-in approved.' } },
    errors: [400, 401, 402, 403, 404, 429],
  },
  {
    method: 'get', path: '/v1/token-info/{token}', operationId: 'getShareLinkInfo', tag: 'Sharing',
    summary: 'Read a share link\'s metadata',
    description: 'Returns what a share link opens and whether it is email-gated, without using it. Needs no authentication.',
    auth: [],
    ok: { 200: { schema: ok('ShareLinkInfoResponse', z.object({
      workspace_id: z.string(),
      file_id: z.string().optional(),
      permission,
      email_gated: z.boolean(),
      email_hint: z.string().optional().describe('Masked email of an email-gated link.'),
      uses_left: z.number().nullable().describe('null when unlimited or email-gated.'),
    })), description: 'Link metadata.' } },
    errors: [401],
  },
  {
    method: 'get', path: '/v1/workspaces', operationId: 'listWorkspaces', tag: 'Workspaces',
    summary: 'List workspaces',
    description: 'Lists the workspaces in the caller\'s org, 50 a page. Not available to share links.',
    auth: ORG,
    query: cursorQuery,
    ok: { 200: { schema: page('WorkspacePage', workspace), description: 'A page of workspaces.' } },
    errors: [401, 403, 429],
  },
  {
    method: 'post', path: '/v1/workspaces', operationId: 'createWorkspace', tag: 'Workspaces',
    summary: 'Create a workspace',
    description: 'Creates a workspace in the caller\'s org. Answers 402 when the plan\'s workspace limit is reached.',
    auth: ORG,
    body: 'CreateWorkspaceRequest',
    headers: PROVENANCE,
    ok: { 201: { schema: workspaceResponse, description: 'Workspace created.' } },
    errors: [400, 401, 402, 403, 429],
  },
  {
    method: 'get', path: '/v1/workspaces/{wid}', operationId: 'getWorkspace', tag: 'Workspaces',
    summary: 'Get a workspace',
    description: 'Reads a workspace. A share link must be for this workspace and not scoped to one file.',
    auth: ANY,
    ok: { 200: { schema: workspaceResponse, description: 'The workspace.' } },
    errors: [401, 404, 429],
  },
  {
    method: 'put', path: '/v1/workspaces/{wid}/bucket-config', operationId: 'assignWorkspaceBucket', tag: 'Storage',
    summary: 'Assign a bucket to a workspace',
    description: 'Sends the workspace\'s new writes to a bring-your-own bucket (or back to the AgentDrive bucket with \'default\'). Existing files keep reading from where they were written. Org owner or admin only; a bucket other than AgentDrive R2 needs the Team plan (403 plan_required).',
    auth: ORG,
    body: 'AssignBucketConfigRequest',
    ok: { 200: { schema: workspaceResponse, description: 'The updated workspace.' } },
    errors: [400, 401, 403, 404, 429],
  },
  {
    method: 'delete', path: '/v1/workspaces/{wid}/bucket-config', operationId: 'clearWorkspaceBucket', tag: 'Storage',
    summary: 'Clear a workspace\'s bucket',
    description: 'Sends the workspace\'s new writes back to the AgentDrive bucket. Org owner or admin only.',
    auth: ORG,
    ok: { 200: { schema: workspaceResponse, description: 'The updated workspace.' } },
    errors: [401, 403, 404, 429],
  },
  {
    method: 'get', path: '/v1/workspaces/{wid}/files', operationId: 'listFiles', tag: 'Files',
    summary: 'List files',
    description: 'Lists file metadata in a workspace, 50 a page, optionally under a path prefix. A file-scoped share link sees only its file.',
    auth: ANY,
    query: { prefix: { schema: z.string(), description: 'Only paths starting with this.' }, ...cursorQuery },
    ok: { 200: { schema: page('FilePage', file), description: 'A page of files.' } },
    errors: [401, 404, 429],
  },
  {
    method: 'post', path: '/v1/workspaces/{wid}/files', operationId: 'writeFile', tag: 'Files',
    summary: 'Write a file',
    description: 'Creates a file at path, or adds a new version when the path exists (200 instead of 201). Needs edit permission. An API key may name a workspace that does not exist yet in place of {wid}; the write creates it, which can answer 402 at the workspace limit.',
    auth: ANY,
    body: 'WriteFileRequest',
    headers: PROVENANCE,
    ok: {
      200: { schema: fileResponse, description: 'New version written.' },
      201: { schema: fileResponse, description: 'File created.' },
    },
    errors: [400, 401, 402, 403, 404, 429],
  },
  {
    method: 'get', path: '/v1/workspaces/{wid}/files/{fid}', operationId: 'getFile', tag: 'Files',
    summary: 'Read a file',
    description: 'Reads a file\'s metadata, and its content with content=true. Reading a session transcript (sessions/<project>/<harness>/<id>.md) from a different harness counts as a cross-agent resume, which can answer 402 when the monthly resume limit is enforced. A content read through a share link counts toward its max_uses.',
    auth: ANY,
    query: { content: { schema: z.enum(['true']), description: 'Include the file content.' } },
    headers: PROVENANCE,
    ok: { 200: { schema: ok('FileContentResponse', z.union([fileWithContent, file]), warning), description: 'The file; with content when content=true.' } },
    errors: [401, 402, 404, 429],
  },
  {
    method: 'put', path: '/v1/workspaces/{wid}/files/{fid}', operationId: 'updateFile', tag: 'Files',
    summary: 'Update a file',
    description: 'Writes a new version of an existing file by id. Needs edit permission.',
    auth: ANY,
    body: 'UpdateFileRequest',
    headers: PROVENANCE,
    ok: { 200: { schema: fileResponse, description: 'New version written.' } },
    errors: [400, 401, 403, 404, 429],
  },
  {
    method: 'delete', path: '/v1/workspaces/{wid}/files/{fid}', operationId: 'deleteFile', tag: 'Files',
    summary: 'Delete a file',
    description: 'Deletes a file and its versions. API keys only.',
    auth: ['apiKey'],
    headers: PROVENANCE,
    ok: { 200: { schema: deleted, description: 'File deleted.' } },
    errors: [401, 403, 404, 429],
  },
  {
    method: 'get', path: '/v1/workspaces/{wid}/files/{fid}/versions', operationId: 'listFileVersions', tag: 'Files',
    summary: 'List file versions',
    description: 'Lists a file\'s version history, 50 a page.',
    auth: ANY,
    query: cursorQuery,
    ok: { 200: { schema: page('FileVersionPage', fileVersion), description: 'A page of versions.' } },
    errors: [401, 404, 429],
  },
  {
    method: 'get', path: '/v1/workspaces/{wid}/files/{fid}/runs', operationId: 'listFileRuns', tag: 'Runs',
    summary: 'List runs that touched a file',
    description: 'Lists the agent runs that referenced or produced this file. Not available to share links.',
    auth: ORG,
    query: cursorQuery,
    ok: { 200: { schema: runPage, description: 'A page of runs.' } },
    errors: [401, 403, 404, 429],
  },
  {
    method: 'post', path: '/v1/workspaces/{wid}/files/{fid}/reindex', operationId: 'reindexFile', tag: 'Files',
    summary: 'Rebuild a file\'s search index',
    description: 'Re-embeds the current version for semantic search, after checking the stored bytes match the content hash. Changes no versions, activity or usage. The vector index applies the change asynchronously, so poll search for availability. Org owner or admin only; shares the search rate limit.',
    limits: ['search'],
    auth: ORG,
    ok: { 200: { schema: ok('ReindexResponse', z.object({
      status: z.literal('accepted'),
      file_id: z.string(),
      content_hash: z.string(),
      mutation_id: z.string(),
      count: z.number(),
    })), description: 'Index update accepted.' } },
    errors: [401, 403, 404, 409, 429, 502],
  },
  {
    method: 'get', path: '/v1/workspaces/{wid}/files/{fid}/comments', operationId: 'listComments', tag: 'Comments',
    summary: 'List comments on a file',
    description: 'Lists a file\'s comments, 50 a page.',
    auth: ANY,
    query: cursorQuery,
    ok: { 200: { schema: page('CommentPage', comment), description: 'A page of comments.' } },
    errors: [401, 404, 429],
  },
  {
    method: 'post', path: '/v1/workspaces/{wid}/files/{fid}/comments', operationId: 'addComment', tag: 'Comments',
    summary: 'Comment on a file',
    description: 'Adds a comment, optionally anchored to a line range. Needs comment permission. Agent feedback is stored as comments.',
    auth: ANY,
    body: 'CreateCommentRequest',
    headers: PROVENANCE,
    ok: { 201: { schema: ok('CommentResponse', comment), description: 'Comment added.' } },
    errors: [400, 401, 403, 404, 429],
  },
  {
    method: 'get', path: '/v1/workspaces/{wid}/activity', operationId: 'listWorkspaceActivity', tag: 'Activity',
    summary: 'List workspace activity',
    description: 'Lists the workspace\'s activity events (writes, comments, shares, roles), 50 a page.',
    auth: ANY,
    query: cursorQuery,
    ok: { 200: { schema: page('ActivityPage', activityEvent), description: 'A page of events.' } },
    errors: [401, 404, 429],
  },
  {
    method: 'get', path: '/v1/workspaces/{wid}/share', operationId: 'listShareLinks', tag: 'Sharing',
    summary: 'List share links',
    description: 'Lists the workspace\'s share links with their use counts. Only principals in the workspace\'s own org; anyone else gets 404.',
    auth: ORG,
    query: cursorQuery,
    ok: { 200: { schema: page('ShareLinkPage', shareLink), description: 'A page of links.' } },
    errors: [401, 404, 429],
  },
  {
    method: 'post', path: '/v1/workspaces/{wid}/share', operationId: 'createShareLink', tag: 'Sharing',
    summary: 'Create a share link',
    description: 'Mints a signed share link for the workspace or one file. An email-gated workspace link also grants that email a role in the workspace. Only principals in the workspace\'s own org; anyone else gets 404.',
    auth: ORG,
    body: 'CreateShareRequest',
    headers: PROVENANCE,
    ok: { 201: { schema: ok('CreateShareResponse', z.object({
      token_id: z.string(),
      url: z.string().describe('The link to hand out; it carries the token.'),
      permission: z.enum(['view', 'comment', 'edit']),
      email_gated: z.boolean(),
      expires_at: iso.optional(),
    })), description: 'Link created.' } },
    errors: [400, 401, 404, 429],
  },
  {
    method: 'delete', path: '/v1/workspaces/{wid}/share/{tid}', operationId: 'revokeShareLink', tag: 'Sharing',
    summary: 'Revoke a share link',
    description: 'Revokes a share link, and the role an email-gated link granted. Only principals in the workspace\'s own org.',
    auth: ORG,
    headers: PROVENANCE,
    ok: { 200: { schema: revoked, description: 'Link revoked.' } },
    errors: [401, 404, 429],
  },
  {
    method: 'get', path: '/v1/workspaces/{wid}/roles', operationId: 'listRoles', tag: 'Roles',
    summary: 'List workspace roles',
    description: 'Lists the email role grants on a workspace. API keys only.',
    auth: ['apiKey'],
    query: cursorQuery,
    ok: { 200: { schema: page('RolePage', roleAssignment), description: 'A page of roles.' } },
    errors: [401, 403, 404, 429],
  },
  {
    method: 'post', path: '/v1/workspaces/{wid}/roles', operationId: 'assignRole', tag: 'Roles',
    summary: 'Grant an email a workspace role',
    description: 'Gives an email view, comment or edit permission on the workspace; that person then reaches it signed in. Replaces any role the email had. API keys only.',
    auth: ['apiKey'],
    body: 'AssignRoleRequest',
    headers: PROVENANCE,
    ok: { 201: { schema: ok('RoleResponse', roleAssignment), description: 'Role granted.' } },
    errors: [400, 401, 403, 404, 429],
  },
  {
    method: 'delete', path: '/v1/workspaces/{wid}/roles/{email}', operationId: 'removeRole', tag: 'Roles',
    summary: 'Remove a workspace role',
    description: 'Removes an email\'s role grant. API keys only.',
    auth: ['apiKey'],
    headers: PROVENANCE,
    ok: { 200: { schema: deleted, description: 'Role removed.' } },
    errors: [401, 403, 404, 429],
  },
  {
    method: 'post', path: '/v1/workspaces/{wid}/sandbox/clone', operationId: 'sandboxClone', tag: 'Sandbox',
    summary: 'Clone a repo into the sandbox',
    description: 'Experimental. Clones a git repository into the workspace\'s Linux sandbox. Needs edit permission in the workspace\'s own org. Answers 503 when the instance has no sandbox.',
    auth: ORG,
    body: 'SandboxCloneRequest',
    ok: { 200: { schema: ok('SandboxStateResponse', sandboxState), description: 'Repository cloned.' } },
    errors: [400, 401, 403, 404, 429, 500, 503],
  },
  {
    method: 'post', path: '/v1/workspaces/{wid}/sandbox/exec', operationId: 'sandboxExec', tag: 'Sandbox',
    summary: 'Run a command in the sandbox',
    description: 'Experimental. Runs a shell command in the workspace\'s sandbox; output is truncated past a size cap. Needs edit permission in the workspace\'s own org. Answers 503 when the instance has no sandbox.',
    auth: ORG,
    body: 'SandboxExecRequest',
    ok: { 200: { schema: ok('SandboxExecResponse', sandboxExecResult), description: 'Command finished.' } },
    errors: [400, 401, 403, 404, 429, 500, 503],
  },
  {
    method: 'get', path: '/v1/workspaces/{wid}/sandbox/files/{path}', operationId: 'sandboxReadFile', tag: 'Sandbox',
    summary: 'Read a file from the sandbox',
    description: 'Experimental. Reads a file from the workspace\'s sandbox filesystem; {path} is the rest of the URL and may contain slashes. Principals in the workspace\'s own org only. Answers 503 when the instance has no sandbox.',
    auth: ORG,
    ok: { 200: { schema: ok('SandboxFileResponse', z.object({ content: z.string(), size: z.number(), truncated: z.boolean() })), description: 'File content.' } },
    errors: [401, 403, 404, 429, 500, 503],
  },
  {
    method: 'post', path: '/v1/workspaces/{wid}/sandbox/commit', operationId: 'sandboxCommit', tag: 'Sandbox',
    summary: 'Commit sandbox changes',
    description: 'Experimental. Commits all changes in the sandbox repository and records the commit as a workspace artifact. Needs edit permission in the workspace\'s own org. Answers 503 when the instance has no sandbox.',
    auth: ORG,
    body: 'SandboxCommitRequest',
    headers: PROVENANCE,
    ok: { 200: { schema: ok('SandboxCommitResponse', sandboxCommitResult), description: 'Changes committed.' } },
    errors: [400, 401, 403, 404, 429, 500, 503],
  },
  {
    method: 'post', path: '/v1/search', operationId: 'searchArtifacts', tag: 'Search',
    summary: 'Search artifacts',
    description: 'Semantic search across the org\'s files, falling back to keyword search when nothing matches semantically. Optionally limited to one workspace and filtered by agent platform, agent or path prefix. Not available to share links; has its own rate limit.',
    limits: ['search'],
    auth: ORG,
    body: 'SearchRequest',
    ok: { 200: { schema: ok('SearchResponse', z.object({ hits: z.array(searchHit), total: z.number() })), description: 'Matching artifacts.' } },
    errors: [400, 401, 403, 404, 429],
  },
  {
    method: 'post', path: '/v1/context', operationId: 'getTaskContext', tag: 'Search',
    summary: 'Get relevant context for a task',
    description: 'Returns the artifacts most relevant to a task description, ranked by semantic match and recency with agent-platform diversity, each with why it was surfaced and the last run that referenced it. Not available to share links; shares the search rate limit.',
    limits: ['search'],
    auth: ORG,
    body: 'ContextRequest',
    ok: { 200: { schema: ok('ContextResponse', z.object({ artifacts: z.array(contextArtifact), retrieved_at: epochMs }), warning), description: 'Relevant artifacts.' } },
    errors: [400, 401, 403, 404, 429],
  },
  {
    method: 'post', path: '/v1/runs', operationId: 'logRun', tag: 'Runs',
    summary: 'Log an agent run',
    description: 'Records what an agent did: the task, the artifacts it read and produced, its status and tool calls. Sending an existing run_id updates that run (200 instead of 201). The run takes its platform and role from X-Agent-Platform and X-Agent-Role. API keys only.',
    auth: ['apiKey'],
    body: 'RunRequest',
    headers: ['platform', 'role'],
    ok: {
      200: { schema: runResponse, description: 'Run updated.' },
      201: { schema: runResponse, description: 'Run created.' },
    },
    errors: [400, 401, 403, 404, 429],
  },
  {
    method: 'get', path: '/v1/runs', operationId: 'listRuns', tag: 'Runs',
    summary: 'List runs',
    description: 'With project, lists that project\'s runs (optionally one platform). Otherwise lists one agent\'s runs: agent_id, or the calling key\'s own. A session with neither gets the newest 50 runs across the org\'s agents, with no further pages.',
    auth: ORG,
    query: {
      project: { schema: projectQuerySchema.shape.project, description: 'Project slug the runs were logged under (metadata.project).' },
      platform: { schema: projectQuerySchema.shape.platform, description: 'With project: only runs from this platform.' },
      limit: { schema: projectQuerySchema.shape.limit, description: 'With project: page size, default 50; values above 100 are treated as 100.' },
      agent_id: { schema: z.string(), description: 'Without project: list this agent\'s runs.' },
      ...cursorQuery,
    },
    ok: { 200: { schema: runPage, description: 'A page of runs.' } },
    errors: [400, 401, 403, 429],
  },
  {
    method: 'get', path: '/v1/runs/{rid}', operationId: 'getRun', tag: 'Runs',
    summary: 'Get a run',
    description: 'Reads one run in the caller\'s org.',
    auth: ORG,
    ok: { 200: { schema: ok('RunDetailResponse', agentRun), description: 'The run.' } },
    errors: [401, 403, 404, 429],
  },
  {
    method: 'get', path: '/v1/org/timeline', operationId: 'getOrgTimeline', tag: 'Activity',
    summary: 'Get the org timeline',
    description: 'Activity across every workspace in the org, newest first: which agent did what, on which artifact. Page back with since= set to the oldest event\'s created_at; cursor is always null. Not available to share links.',
    auth: ORG,
    query: {
      since: { schema: timelineQuerySchema.shape.since, description: 'Only events after this ISO 8601 time.' },
      limit: { schema: timelineQuerySchema.shape.limit, description: 'Events to return, default 200, at most 1000.' },
    },
    ok: { 200: { schema: ok('TimelineResponse', z.array(activityEvent), {
      cursor: z.null(),
      truncated: z.boolean().describe('True when the response holds exactly limit events, so older ones may exist.'),
    }), description: 'Timeline events.' } },
    errors: [400, 401, 403, 429],
  },
  {
    method: 'get', path: '/v1/org', operationId: 'getOrg', tag: 'Org',
    summary: 'Get the org',
    description: 'Reads the caller\'s org with its agents, members, pending invites (each paged separately), usage and plan quota. On a self-hosted instance every quota is null (unlimited).',
    auth: ORG,
    query: {
      agents_cursor: { schema: z.string(), description: 'Cursor for the next page of agents.' },
      members_cursor: { schema: z.string(), description: 'Cursor for the next page of members.' },
      invites_cursor: { schema: z.string(), description: 'Cursor for the next page of invites.' },
    },
    ok: { 200: { schema: ok('OrgDetailResponse', org.extend({
      agents: z.array(orgAgent),
      members: z.array(orgMember),
      invites: z.array(orgInvite),
      usage,
      quota: z.union([planQuota, z.record(z.string(), z.null())]),
    }), { agents_cursor: cursor, members_cursor: cursor, invites_cursor: cursor }), description: 'The org.' } },
    errors: [401, 404, 429],
  },
  {
    method: 'patch', path: '/v1/org', operationId: 'renameOrg', tag: 'Org',
    summary: 'Rename the org',
    description: 'Changes the caller\'s org name. Only org owners and admins, the keys they mint, and a self-registered org\'s founding agent may rename it; anyone else gets 403.',
    auth: ORG,
    body: 'RenameOrgRequest',
    ok: { 200: { schema: ok('OrgResponse', org), description: 'The renamed org.' } },
    errors: [400, 401, 403, 404, 429],
  },
  {
    method: 'post', path: '/v1/org/invite', operationId: 'inviteMember', tag: 'Org',
    summary: 'Invite a person to the org',
    description: 'Invites an email to the org and emails them a sign-in code. The invite grants nothing until they accept it signed in. Only an owner can invite an owner, and only an owner or admin (or a key one of them made) an admin. Answers 402 at the seat limit. Disabled (501) on a self-hosted instance.',
    auth: ORG,
    body: 'InviteRequest',
    ok: { 201: { schema: ok('InviteResponse', orgInvite), description: 'Invite created.' } },
    errors: [400, 401, 402, 403, 404, 429, 501],
  },
  {
    method: 'get', path: '/v1/org/invites', operationId: 'listMyInvites', tag: 'Org',
    summary: 'List my pending invites',
    description: 'Lists the invites addressed to the signed-in email. Session only.',
    auth: ['session'],
    query: cursorQuery,
    ok: { 200: { schema: page('InvitePage', orgInvite), description: 'A page of invites.' } },
    errors: [401, 403, 429],
  },
  {
    method: 'post', path: '/v1/org/invites/{org_id}/accept', operationId: 'acceptInvite', tag: 'Org',
    summary: 'Accept an invite',
    description: 'Joins the inviting org and makes it the session\'s org. Session only, as the invited email. Answers 402 at the seat limit.',
    auth: ['session'],
    ok: { 200: { schema: ok('MemberResponse', orgMember), description: 'Joined.' } },
    errors: [401, 402, 403, 404, 429],
  },
  {
    method: 'post', path: '/v1/org/invites/{org_id}/decline', operationId: 'declineInvite', tag: 'Org',
    summary: 'Decline an invite',
    description: 'Deletes an invite addressed to the signed-in email. Session only.',
    auth: ['session'],
    ok: { 200: { schema: flag('DeclinedResponse', 'declined'), description: 'Invite declined.' } },
    errors: [401, 403, 404, 429],
  },
  {
    method: 'delete', path: '/v1/org/members/{email}', operationId: 'removeMember', tag: 'Org',
    summary: 'Remove a member or revoke an invite',
    description: 'Removes the member, revokes a pending invite to that email, or both; removal also ends the keys, links and grants they issued. Owners remove anyone; admins and a registered org\'s founding agent remove non-owners; a member may remove themselves. The last owner cannot be removed (409).',
    auth: ORG,
    ok: { 200: { schema: flag('RemovedResponse', 'removed'), description: 'Removed.' } },
    errors: [401, 403, 404, 409, 429],
  },
  {
    method: 'get', path: '/v1/keys', operationId: 'listApiKeys', tag: 'Keys',
    summary: 'List API keys',
    description: 'Lists the org\'s managed API keys, never the secrets.',
    auth: ORG,
    query: cursorQuery,
    ok: { 200: { schema: page('ApiKeyPage', apiKey), description: 'A page of keys.' } },
    errors: [401, 403, 429],
  },
  {
    method: 'post', path: '/v1/keys', operationId: 'createApiKey', tag: 'Keys',
    summary: 'Create an API key',
    description: 'Mints a new API key; each key is its own agent principal. The secret is returned only in this response. Answers 402 at the plan\'s agent limit.',
    auth: ORG,
    body: 'CreateKeyRequest',
    ok: { 201: { schema: ok('CreateApiKeyResponse', apiKey.extend({ api_key: z.string().describe('agentdrive_live_... Shown once.') })), description: 'Key created.' } },
    errors: [400, 401, 402, 403, 429],
  },
  {
    method: 'delete', path: '/v1/keys/{key_id}', operationId: 'revokeApiKey', tag: 'Keys',
    summary: 'Revoke an API key',
    description: 'Revokes a key, ending the share links and role grants it issued. A key can revoke itself and keys it created; a session can revoke keys it created, and an owner any key.',
    auth: ORG,
    ok: { 200: { schema: revoked, description: 'Key revoked.' } },
    errors: [401, 403, 404, 429],
  },
  {
    method: 'post', path: '/v1/bucket-config', operationId: 'createBucketConfig', tag: 'Storage',
    summary: 'Add a bring-your-own bucket',
    description: 'Stores credentials for a Cloudflare R2 (cross-account) or S3-compatible bucket; those providers need endpoint, region, bucket, access_key_id and secret_access_key. Run verify before use. Org owner or admin only; a provider other than agentdrive-r2 needs the Team plan (403 plan_required).',
    auth: ORG,
    body: 'CreateBucketConfigRequest',
    ok: { 201: { schema: bucketConfigResponse, description: 'Bucket config created.' } },
    errors: [400, 401, 403, 429],
  },
  {
    method: 'get', path: '/v1/bucket-config', operationId: 'listBucketConfigs', tag: 'Storage',
    summary: 'List bucket configs',
    description: 'Lists the org\'s bucket configs, without secrets.',
    auth: ORG,
    query: cursorQuery,
    ok: { 200: { schema: page('BucketConfigPage', bucketConfig), description: 'A page of bucket configs.' } },
    errors: [401, 403, 429],
  },
  {
    method: 'get', path: '/v1/bucket-config/{id}', operationId: 'getBucketConfig', tag: 'Storage',
    summary: 'Get a bucket config',
    description: 'Reads one bucket config, without its secret.',
    auth: ORG,
    ok: { 200: { schema: bucketConfigResponse, description: 'The bucket config.' } },
    errors: [401, 403, 404, 429],
  },
  {
    method: 'post', path: '/v1/bucket-config/{id}/verify', operationId: 'verifyBucketConfig', tag: 'Storage',
    summary: 'Verify a bucket\'s credentials',
    description: 'Writes, reads back and deletes a probe object in the bucket. Success marks it healthy; failure marks it degraded and answers 502 with the error. Org owner or admin only.',
    auth: ORG,
    ok: { 200: { schema: bucketConfigResponse, description: 'Bucket verified.' } },
    errors: [401, 403, 404, 429, 502],
  },
  {
    method: 'delete', path: '/v1/bucket-config/{id}', operationId: 'deleteBucketConfig', tag: 'Storage',
    summary: 'Delete a bucket config',
    description: 'Deletes a bucket config. Answers 409 while any workspace still uses it. Org owner or admin only.',
    auth: ORG,
    ok: { 200: { schema: deleted, description: 'Bucket config deleted.' } },
    errors: [401, 403, 404, 409, 429],
  },
  {
    method: 'get', path: '/v1/billing/plan', operationId: 'getBillingPlan', tag: 'Billing',
    summary: 'Get plan and usage',
    description: 'Reads the org\'s plan, usage against quota (including this month\'s cross-agent resumes) and the usage status every surface shows. Disabled (501) on a self-hosted instance.',
    auth: ORG,
    ok: { 200: { schema: ok('BillingPlanResponse', z.object({
      plan,
      trial_ends_at: iso.optional(),
      usage: usage.extend({ resume_count: z.number().optional() }),
      quota: planQuota,
      status: usageStatus,
      stripe_customer_id: z.string().optional(),
    })), description: 'Plan and usage.' } },
    errors: [401, 404, 429, 501],
  },
  {
    method: 'post', path: '/v1/billing/checkout', operationId: 'createCheckout', tag: 'Billing',
    summary: 'Start a Stripe checkout',
    description: 'Opens a Stripe Checkout session for Pro or Team (Team takes seats, default 3). Org owner or admin only. Disabled (501) on a self-hosted instance.',
    auth: ORG,
    body: 'CheckoutRequest',
    ok: { 200: { schema: ok('CheckoutResponse', z.object({ session_id: z.string(), checkout_url: z.string() })), description: 'Checkout opened.' } },
    errors: [400, 401, 403, 404, 409, 429, 501, 502, 503],
  },
  {
    method: 'post', path: '/v1/billing/portal', operationId: 'createBillingPortal', tag: 'Billing',
    summary: 'Open the Stripe billing portal',
    description: 'Returns a Stripe Customer Portal link for changing or cancelling the subscription. Answers 409 before the org has subscribed. Org owner or admin only. Disabled (501) on a self-hosted instance.',
    auth: ORG,
    query: { cli: { schema: z.enum(['1']), description: 'Return to the CLI billing page afterwards.' } },
    ok: { 200: { schema: ok('PortalResponse', z.object({ url: z.string() })), description: 'Portal link.' } },
    errors: [401, 403, 404, 409, 429, 501, 502, 503],
  },
  {
    method: 'get', path: '/v1/billing/invoices', operationId: 'listInvoices', tag: 'Billing',
    summary: 'List invoices',
    description: 'Lists the org\'s 12 most recent Stripe invoices; empty before the org has subscribed. Org owner or admin only. Disabled (501) on a self-hosted instance.',
    auth: ORG,
    ok: { 200: { schema: ok('InvoicesResponse', z.array(z.object({
      id: z.string(),
      date: z.string().describe('YYYY-MM-DD'),
      total: z.number().describe('In major currency units.'),
      currency: z.string(),
      status: z.string(),
      pdfUrl: z.string().optional(),
      hostedUrl: z.string().optional(),
    }))), description: 'Invoices.' } },
    errors: [401, 403, 404, 429, 501, 502, 503],
  },
];

const ERRORS: Record<ErrorStatus, { name: string; description: string; schema?: z.ZodType; limited?: boolean }> = {
  400: { name: 'BadRequest', description: 'The request body, query or Idempotency-Key header failed validation.' },
  401: { name: 'Unauthorized', description: 'Credentials are missing, invalid, expired or revoked.' },
  402: { name: 'PlanLimit', description: 'The org is at a plan limit; the body says which and links the upgrade.', schema: planLimit },
  403: { name: 'Forbidden', description: 'This principal may not do this.' },
  404: { name: 'NotFound', description: 'Not found, or not visible to this principal.' },
  409: { name: 'Conflict', description: 'The request conflicts with current state; or a request with the same Idempotency-Key is still running (idempotency_key_in_use), or already ran and its response was too large to keep (idempotency_response_not_stored).' },
  422: { name: 'IdempotencyKeyReused', description: 'The Idempotency-Key was already used for a different request (idempotency_key_reused).' },
  429: { name: 'RateLimited', description: 'Rate limited; retry after Retry-After seconds.', limited: true },
  500: { name: 'InternalError', description: 'The operation failed on the server.' },
  501: { name: 'NotImplemented', description: 'Disabled on a self-hosted instance.' },
  502: { name: 'BadGateway', description: 'An upstream service (Stripe, email, a storage bucket or the vector index) failed.' },
  503: { name: 'Unavailable', description: 'A required service is not configured on this instance.' },
};

const PATH_PARAMS: Record<string, string> = {
  wid: 'Workspace id (ws_...). An API key or session may also pass a workspace name from its own org.',
  fid: 'File id.',
  tid: 'Share link id (token_id).',
  email: 'Email address, URL-encoded.',
  id: 'Bucket config id.',
  org_id: 'Id of the org that sent the invite.',
  key_id: 'API key id.',
  rid: 'Run id.',
  token: 'The share token from a share link.',
  path: 'Sandbox file path; may contain slashes.',
};

const HEADERS: Record<Header, object> = {
  platform: { $ref: '#/components/parameters/AgentPlatform' },
  role: { $ref: '#/components/parameters/AgentRole' },
  bootstrap: {
    name: 'X-Bootstrap-Token', in: 'header', required: false,
    description: 'Self-hosted instances only: the operator\'s bootstrap token, without which registration is closed.',
    schema: { type: 'string' },
  },
};

const SECURITY: Record<Principal, object[]> = {
  apiKey: [{ apiKey: [] }],
  session: [{ session: [] }],
  share: [{ shareToken: [] }, { shareTokenQuery: [] }],
};

const ref = (id: string) => ({ $ref: `#/components/schemas/${id}` });
const headerRef = (id: string) => ({ $ref: `#/components/headers/${id}` });

const idempotent = (op: Operation) => op.auth.length > 0 && supportsIdempotency(op.method, op.path);

function errorStatuses(op: Operation): ErrorStatus[] {
  return idempotent(op) ? [...new Set<ErrorStatus>([...op.errors, 400, 409, 422])].sort() : op.errors;
}

function jsonSchema(schema: z.ZodType): object {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, { io: 'input' });
  return rest;
}

function schemaRef(schema: z.ZodType): object {
  const id = registry.get(schema)?.id;
  if (!id) throw new Error('OpenAPI response schemas must be components');
  return ref(id);
}

function buildOperation(op: Operation): object {
  const pathParams = [...op.path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
    name, in: 'path', required: true, description: PATH_PARAMS[name!], schema: { type: 'string' },
  }));
  const queryParams = Object.entries(op.query ?? {}).map(([name, q]) => ({
    name, in: 'query', required: !!q.required, description: q.description, schema: jsonSchema(q.schema),
  }));
  const headers = {
    ...(op.auth.length || op.limits ? { 'RateLimit-Policy': headerRef('RateLimitPolicy') } : {}),
    ...(idempotent(op) ? { 'Idempotent-Replayed': headerRef('IdempotentReplayed') } : {}),
  };
  const responses: Record<string, object> = {};
  for (const [status, res] of Object.entries(op.ok)) {
    responses[status] = {
      description: res.description,
      ...(Object.keys(headers).length ? { headers } : {}),
      content: { 'application/json': { schema: schemaRef(res.schema) } },
    };
  }
  for (const status of errorStatuses(op)) responses[status] = { $ref: `#/components/responses/${ERRORS[status].name}` };
  return {
    operationId: op.operationId,
    summary: op.summary,
    description: op.description,
    tags: [op.tag],
    security: op.auth.flatMap((p) => SECURITY[p]),
    parameters: [
      ...pathParams,
      ...queryParams,
      ...(op.headers ?? []).map((h) => HEADERS[h]),
      ...(idempotent(op) ? [{ $ref: '#/components/parameters/IdempotencyKey' }] : []),
    ],
    ...(op.body ? {
      requestBody: { required: true, content: { 'application/json': { schema: ref(op.body) } } },
    } : {}),
    responses,
  };
}

export function buildOpenApiDocument() {
  const { schemas } = z.toJSONSchema(registry, { io: 'input', uri: (id) => `#/components/schemas/${id}` });
  const componentsSchemas = Object.fromEntries(
    Object.entries(schemas).map(([id, { $schema: _s, $id: _i, ...rest }]) => [id, rest]),
  );
  const paths: Record<string, Record<string, object>> = {};
  for (const op of operations) (paths[op.path] ??= {})[op.method] = buildOperation(op);

  const used = new Set(operations.flatMap(errorStatuses));
  const responses = Object.fromEntries([...used].sort().map((status) => {
    const e = ERRORS[status];
    return [e.name, {
      description: e.description,
      ...(e.limited ? { headers: { 'Retry-After': headerRef('RetryAfter'), 'RateLimit-Policy': headerRef('RateLimitPolicy') } } : {}),
      content: { 'application/json': { schema: schemaRef(e.schema ?? errorBody) } },
    }];
  }));

  return {
    openapi: '3.1.0',
    info: {
      title: 'AgentDrive REST API',
      version: '1.0.0',
      summary: 'Cross-agent artifact workspace with provenance.',
      description: 'The HTTP surface that the AgentDrive MCP server, CLI and SDKs wrap: versioned workspace files, cross-agent session resume, semantic search, run provenance, sharing and org management. Errors are `{ "success": false, "code": "...", "error": "..." }` (the Error schema). Paginated lists return `data` with a sibling `cursor`; pass it back as `?cursor=` until it is null. Authenticated POST, PUT and PATCH operations take an Idempotency-Key header, and responses name the rate limits they were checked against in RateLimit-Policy.',
      license: { name: 'AGPL-3.0-only', identifier: 'AGPL-3.0-only' },
      contact: { name: 'AgentDrive', url: 'https://agentdrive.sh' },
    },
    externalDocs: { description: 'REST API guide', url: 'https://agentdrive.sh/docs/rest-api' },
    servers: [{ url: 'https://app.agentdrive.sh', description: 'AgentDrive cloud' }],
    tags: [
      { name: 'Meta', description: 'Service health.' },
      { name: 'Registration', description: 'Create an org and its first agent key.' },
      { name: 'Auth', description: 'Human sign-in, sessions and CLI sign-in.' },
      { name: 'Workspaces', description: 'Workspaces hold an org\'s files.' },
      { name: 'Files', description: 'Versioned, content-addressed files, including synced session transcripts.' },
      { name: 'Comments', description: 'Comments and feedback on files.' },
      { name: 'Activity', description: 'Provenance: which agent did what, on which artifact.' },
      { name: 'Sharing', description: 'Signed share links.' },
      { name: 'Roles', description: 'Per-workspace roles for outside emails.' },
      { name: 'Sandbox', description: 'Experimental per-workspace Linux sandbox; 503 when not provisioned.' },
      { name: 'Search', description: 'Semantic search and task context across agents\' work.' },
      { name: 'Runs', description: 'Agent run logs.' },
      { name: 'Org', description: 'The org, its members and invites.' },
      { name: 'Keys', description: 'API key management.' },
      { name: 'Storage', description: 'Bring-your-own bucket configuration.' },
      { name: 'Billing', description: 'Plan, usage and Stripe billing.' },
    ],
    paths,
    components: {
      securitySchemes: {
        apiKey: {
          type: 'http', scheme: 'bearer', bearerFormat: 'agentdrive_live_...',
          description: 'An agent API key from /v1/register or /v1/keys. One key is one principal; X-Agent-Platform and X-Agent-Role tell its sessions apart in provenance.',
        },
        session: {
          type: 'apiKey', in: 'header', name: 'X-Session-Token',
          description: 'A human session id from /v1/auth/verify-code or OAuth sign-in. An email-gated share link needs it too, signed in as that email.',
        },
        shareToken: {
          type: 'apiKey', in: 'header', name: 'X-Share-Token',
          description: 'A share token from a share link; it carries its own permission and scope. Not accepted as a bearer token.',
        },
        shareTokenQuery: {
          type: 'apiKey', in: 'query', name: 'token',
          description: 'The share token as a query parameter, as share URLs carry it.',
        },
      },
      parameters: {
        AgentPlatform: {
          name: 'X-Agent-Platform', in: 'header', required: false,
          description: 'The harness making the call, recorded in provenance. Read only with an API key; case-insensitive, and any other value is recorded as unknown.',
          // Any string is accepted, so an enum here would make generated clients reject valid calls.
          schema: { type: 'string', examples: [...AGENT_PLATFORMS] },
        },
        AgentRole: {
          name: 'X-Agent-Role', in: 'header', required: false,
          description: 'Free-form role of the agent (e.g. planner, coder, reviewer), recorded on runs. Read only with an API key; truncated to 64 characters.',
          schema: { type: 'string' },
        },
        IdempotencyKey: {
          name: 'Idempotency-Key', in: 'header', required: false,
          description: `Makes a retry safe (draft-ietf-httpapi-idempotency-key-header). Keys are scoped to the calling principal and kept 24 hours. A retry with the same key and the same method, path, query and body gets the first response again, with Idempotent-Replayed: true, and does not run again. The same key with a different request answers 422; a retry while the first is still running answers 409. 401, 403, 404, 429 and 5xx responses are not kept, so the key can be retried. A response over ${MAX_STORED_RESPONSE_BYTES} bytes is not kept either: its key stays used and a retry answers 409 idempotency_response_not_stored.`,
          schema: { type: 'string', minLength: 1, maxLength: 255, pattern: '^[!-~]+$' },
        },
      },
      headers: {
        RateLimitPolicy: {
          description: `The rate limits this request was checked against, as a draft-ietf-httpapi-ratelimit-headers List: q requests per w seconds, counted per Cloudflare location. All policies: ${rateLimitPolicy(Object.keys(LIMITERS) as Kind[])}. principal and search count per API key, session or share link; ip_register and ip_magic per client IP. Remaining quota is not reported.`,
          schema: { type: 'string', examples: [rateLimitPolicy(['principal'])] },
        },
        RetryAfter: {
          description: 'Seconds to wait before retrying.',
          schema: { type: 'integer' },
        },
        IdempotentReplayed: {
          description: 'Set on a response replayed for a retried Idempotency-Key; the request did not run again.',
          schema: { type: 'string', enum: ['true'] },
        },
      },
      schemas: componentsSchemas,
      responses,
    },
  };
}
