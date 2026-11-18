// Browser/server-side API client for the AgentDrive Worker.
// Mirrors the shape of packages/cli/src/lib/api-client.ts but uses the browser
// fetch API and reads its API key from the web session cookie/local store.

import type { OrgInvite, PaidPlan, Plan, ShareTokenMeta } from '@agentdrive/shared';
import type { WebSession } from './session';

export interface ApiClientConfig {
  baseUrl?: string;
  apiKey?: string;
  agentPlatform?: string;
  agentRole?: string;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  cursor?: string | null;
  error?: string;
}

export interface PagedResponse<T> {
  items: T[];
  cursor: string | null;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  created_at: string;
  agent_count?: number;
}

export interface FileSummary {
  id: string;
  path: string;
  version: number;
  size: number;
  updated_at: string;
}

export interface FileContent extends FileSummary {
  content: string;
  content_hash?: string;
  mime_type?: string;
}

export interface SearchHit {
  path: string;
  ws_id: string;
  content_hash: string;
  score: number | null;
  match_kind?: 'semantic' | 'keyword';
  snippet?: string;
  agent_id: string;
  agent_platform: string;
  created_at: number;
}

export interface RunRecord {
  run_id: string;
  task: string;
  status: 'success' | 'failure' | 'partial' | 'in_progress';
  artifacts_referenced?: string[];
  artifacts_produced?: string[];
  duration_ms?: number;
  metadata?: Record<string, unknown>;
  created_at: number;
  agent_id?: string;
  agent_platform?: string;
  agent_role?: string;
}

export interface CreatedShare {
  token_id: string;
  url: string;
  permission: 'view' | 'comment' | 'edit';
  email_gated: boolean;
  expires_at?: string;
}

export interface BillingPortal {
  url: string;
}

export type BucketProvider =
  | 'agentdrive-r2'
  | 'cf-r2-cross-account'
  | 's3-hmac';

export type BucketHealth = 'healthy' | 'degraded' | 'unverified';

export interface BucketConfig {
  id: string;
  org_id: string;
  name: string;
  provider: BucketProvider;
  endpoint?: string;
  region?: string;
  bucket?: string;
  access_key_id?: string;
  health: BucketHealth;
  last_verified_at?: string;
  last_error?: string;
  created_at: string;
  created_by: string;
}

export interface CreateBucketConfigInput {
  name: string;
  provider: BucketProvider;
  endpoint?: string;
  region?: string;
  bucket?: string;
  access_key_id?: string;
  secret_access_key?: string;
}

// Matches limits.ts usageStatus in the worker.
export interface UsageStatus {
  level: 'ok' | 'warn80' | 'warn90' | 'warn99';
  message?: string;
  upgrade_url: string;
}

export interface BillingPlan {
  plan: Plan;
  trial_ends_at?: string;
  // resume_count is left out when the worker could not count it.
  usage: Record<string, number | undefined>;
  // A null quota is unlimited.
  quota: Record<string, number | null>;
  status?: UsageStatus;
  stripe_customer_id?: string;
}

// Matches the worker's GET /v1/billing/invoices shape and the InvoiceRow props.
export interface InvoiceSummary {
  id: string;
  date: string;
  total: number;
  currency?: string;
  status: string;
  pdfUrl?: string;
  hostedUrl?: string;
}

export interface AuthProviders {
  google: boolean;
  github: boolean;
  email: boolean;
}

export interface OrgAgent {
  org_id: string;
  agent_id: string;
  agent_name?: string;
  agent_email?: string;
  joined_at: string;
  revoked_at?: string;
}

export interface OrgMember {
  org_id: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  joined_at: string;
  invited_by: string;
}

export interface OrgDetail {
  id: string;
  name: string;
  plan: string;
  created_at: string;
  created_by: string;
  trial_ends_at?: string;
  stripe_customer_id?: string;
  agents: OrgAgent[];
  members: OrgMember[];
  invites: OrgInvite[];
  usage: Record<string, number>;
  quota: Record<string, number | null>;
}

export interface ApiKeyRecord {
  key_id: string;
  org_id: string;
  agent_id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at?: string;
}

// POST /v1/keys returns the record plus the raw secret, exactly once.
export interface CreatedApiKey extends ApiKeyRecord {
  api_key: string;
}

// Canonical shape for /v1/workspaces/:wid/files/:fid/versions. Worker
// returns rows from `file_ver:<ws>:<path>:<n>`. The optional auth fields
// are populated once the worker exposes agent identity per-version; until
// then the UI degrades gracefully.
export interface FileVersionRecord {
  actor_id?: string;
  actor_type?: 'agent' | 'human';
  version: number;
  path?: string;
  size: number;
  content_hash: string;
  agent_id?: string;
  author_agent_id?: string;
  author_platform?: string;
  author_role?: string;
  message?: string;
  created_at: string;
}

// Canonical shape for /v1/workspaces/:wid/files/:fid/comments. Worker
// returns `comment:<ws>:<path>:<comment_id>` rows. We accept both `id`
// and `comment_id` so this matches the worker payload and ZETA's draft.
export interface CommentRecord {
  id?: string;
  comment_id?: string;
  workspace_id?: string;
  path: string;
  body: string;
  author?: string;
  author_id?: string;
  author_name?: string;
  author_type?: 'agent' | 'human';
  author_agent_id?: string;
  author_platform?: string;
  author_email?: string;
  resolved?: boolean;
  created_at: string;
}

export interface ActivityEvent {
  id: string;
  workspace_id: string;
  actor_type: 'agent' | 'human';
  actor_id: string;
  agent_platform?: string;
  action: string;
  target_type: string;
  target_id: string;
  target_path?: string;
  metadata?: Record<string, string>;
  created_at: string;
}

export interface TimelinePage {
  items: ActivityEvent[];
  truncated: boolean;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

const DEFAULT_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'https://app.agentdrive.sh';

export class ApiClient {
  private baseUrl: string;
  private apiKey?: string;
  private agentPlatform: string;
  private agentRole: string;
  private fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;

  constructor(config: ApiClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.agentPlatform = config.agentPlatform ?? 'web';
    this.agentRole = config.agentRole ?? 'dashboard';
    this.fetchImpl = config.fetch ?? ((url, init) => fetch(url, init));
  }

  static fromSession(
    session: WebSession | null,
    overrides: Partial<ApiClientConfig> = {},
  ): ApiClient {
    return new ApiClient({
      apiKey: session?.api_key,
      ...overrides,
    });
  }

  private headers(authRequired: boolean): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Agent-Platform': this.agentPlatform,
      'X-Agent-Role': this.agentRole,
    };
    if (authRequired && this.apiKey) {
      // Browser sign-ins hold a session id, which the worker only accepts as X-Session-Token.
      if (this.apiKey.startsWith('agentdrive_')) h['Authorization'] = `Bearer ${this.apiKey}`;
      else h['X-Session-Token'] = this.apiKey;
    }
    return h;
  }

  private checkSession(res: Response, authRequired = true): void {
    if (res.status === 401 && authRequired && typeof window !== 'undefined') {
      const next = window.location.pathname + window.location.search;
      window.location.replace(`/session/expired?next=${encodeURIComponent(next)}`);
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    authRequired = true,
  ): Promise<T> {
    const url = `${this.baseUrl}/v1${path}`;
    const res = await this.fetchImpl(url, {
      method,
      headers: this.headers(authRequired),
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'omit',
      cache: 'no-store',
    });
    this.checkSession(res, authRequired);
    let json: ApiEnvelope<T>;
    try {
      json = (await res.json()) as ApiEnvelope<T>;
    } catch {
      throw new ApiError(
        `Invalid JSON response (status ${res.status})`,
        res.status,
      );
    }
    if (!res.ok || !json.success) {
      throw new ApiError(
        json.error ?? `Request failed (${res.status})`,
        res.status,
      );
    }
    return json.data as T;
  }

  private async requestPage<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<PagedResponse<T>> {
    const url = `${this.baseUrl}/v1${path}`;
    const res = await this.fetchImpl(url, {
      method,
      headers: this.headers(true),
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'omit',
      cache: 'no-store',
    });
    this.checkSession(res);
    const json = (await res.json()) as ApiEnvelope<T[]>;
    if (!res.ok || !json.success) {
      throw new ApiError(
        json.error ?? `Request failed (${res.status})`,
        res.status,
      );
    }
    return { items: (json.data ?? []) as T[], cursor: json.cursor ?? null };
  }

  // --- Auth ---

  async whoami(): Promise<unknown> {
    return this.request<unknown>('GET', '/auth/me');
  }

  async logout(): Promise<unknown> {
    return this.request<unknown>('POST', '/auth/logout', {});
  }

  async getAuthProviders(): Promise<AuthProviders> {
    return this.request<AuthProviders>(
      'GET',
      '/auth/providers',
      undefined,
      false,
    );
  }

  async sendMagicCode(email: string, purpose: 'verify' | 'login' = 'login') {
    return this.request<{ message: string }>(
      'POST',
      '/auth/send-code',
      { email, purpose },
      false,
    );
  }

  async verifyMagicCode(email: string, code: string) {
    return this.request<{
      session_id: string;
      email: string;
      org_id?: string;
      expires_at: string;
    }>('POST', '/auth/verify-code', { email, code }, false);
  }

  // --- Workspaces ---

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    const all: WorkspaceSummary[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const url: string = cursor
        ? `/workspaces?cursor=${encodeURIComponent(cursor)}`
        : '/workspaces';
      const page = await this.requestPage<WorkspaceSummary>('GET', url);
      all.push(...page.items);
      if (!page.cursor) return all;
      cursor = page.cursor;
    }
    throw new Error('Too many workspaces to load. Please retry or contact support.');
  }

  async createWorkspace(name: string) {
    return this.request<WorkspaceSummary>('POST', '/workspaces', { name });
  }

  async listActivity(
    workspaceId: string,
    cursor?: string,
  ): Promise<PagedResponse<ActivityEvent>> {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.requestPage<ActivityEvent>(
      'GET',
      `/workspaces/${workspaceId}/activity${q}`,
    );
  }

  // --- Org ---

  async getOrg(): Promise<OrgDetail> {
    return this.request<OrgDetail>('GET', '/org');
  }

  async listOrgTimeline(
    opts: { since?: string; limit?: number } = {},
  ): Promise<TimelinePage> {
    const q = new URLSearchParams();
    if (opts.since) q.set('since', opts.since);
    if (typeof opts.limit === 'number') q.set('limit', String(opts.limit));
    const path = `/org/timeline${q.toString() ? `?${q}` : ''}`;
    // /v1/org/timeline returns `{ success, data: [...], cursor: null, truncated }`
    // — the envelope shape is the same as requestPage but we also surface
    // `truncated` so the UI can show "more available" affordance.
    const url = `${this.baseUrl}/v1${path}`;
    const res = await this.fetchImpl(url, { method: 'GET', headers: this.headers(true), cache: 'no-store' });
    this.checkSession(res);
    const json = (await res.json()) as {
      success: boolean;
      data?: ActivityEvent[];
      error?: string;
      truncated?: boolean;
    };
    if (!res.ok || !json.success) {
      throw new ApiError(json.error ?? `API request failed (${res.status})`, res.status);
    }
    return { items: json.data ?? [], truncated: !!json.truncated };
  }

  // --- Files ---

  async listFiles(
    workspaceId: string,
    prefix?: string,
    cursor?: string,
  ): Promise<PagedResponse<FileSummary>> {
    const q = new URLSearchParams();
    if (prefix) q.set('prefix', prefix);
    if (cursor) q.set('cursor', cursor);
    const path = `/workspaces/${workspaceId}/files${
      q.toString() ? `?${q}` : ''
    }`;
    return this.requestPage<FileSummary>('GET', path);
  }

  async getFile(
    workspaceId: string,
    fid: string,
    includeContent = false,
  ): Promise<FileContent | FileSummary> {
    const q = includeContent ? '?content=true' : '';
    return this.request<FileContent | FileSummary>(
      'GET',
      `/workspaces/${workspaceId}/files/${fid}${q}`,
    );
  }

  async writeFile(
    workspaceId: string,
    path: string,
    content: string,
    message?: string,
  ) {
    return this.request<FileSummary>(
      'POST',
      `/workspaces/${workspaceId}/files`,
      { path, content, message },
    );
  }

  async listFileVersions(
    workspaceId: string,
    fid: string,
    cursor?: string,
  ): Promise<PagedResponse<FileVersionRecord>> {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.requestPage<FileVersionRecord>(
      'GET',
      `/workspaces/${workspaceId}/files/${fid}/versions${q}`,
    );
  }

  async listFileComments(
    workspaceId: string,
    fid: string,
    cursor?: string,
  ): Promise<PagedResponse<CommentRecord>> {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.requestPage<CommentRecord>(
      'GET',
      `/workspaces/${workspaceId}/files/${fid}/comments${q}`,
    );
  }

  async addFileComment(workspaceId: string, fid: string, body: string): Promise<CommentRecord> {
    return this.request<CommentRecord>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/files/${encodeURIComponent(fid)}/comments`, { body });
  }

  // --- Search / context / runs ---

  async search(body: {
    query: string;
    workspace_id?: string;
    top_k?: number;
    filter?: Record<string, string>;
  }) {
    return this.request<{ hits: SearchHit[]; total: number }>(
      'POST',
      '/search',
      body,
    );
  }

  async context(body: {
    task: string;
    workspace_id?: string;
    limit?: number;
  }) {
    return this.request<{ artifacts: SearchHit[]; retrieved_at: number }>(
      'POST',
      '/context',
      body,
    );
  }

  async listRuns(cursor?: string) {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.requestPage<RunRecord>('GET', `/runs${q}`);
  }

  async getRun(runId: string): Promise<RunRecord> {
    return this.request<RunRecord>('GET', `/runs/${runId}`);
  }

  async listRunsByArtifact(workspaceId: string, fileId: string, cursor?: string) {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.requestPage<RunRecord>(
      'GET',
      `/workspaces/${workspaceId}/files/${fileId}/runs${q}`,
    );
  }

  // --- Billing ---

  async billingPlan(): Promise<BillingPlan> {
    return this.request<BillingPlan>('GET', '/billing/plan');
  }

  async billingPortal(): Promise<BillingPortal> {
    return this.request<BillingPortal>('POST', '/billing/portal', {});
  }

  async billingCheckout(plan: PaidPlan, seats?: number) {
    return this.request<{ checkout_url: string; session_id: string }>(
      'POST',
      '/billing/checkout',
      { plan, seats },
    );
  }

  async billingInvoices(): Promise<InvoiceSummary[]> {
    return this.request<InvoiceSummary[]>('GET', '/billing/invoices');
  }

  // --- Team ---

  async inviteMember(
    email: string,
    role: 'owner' | 'admin' | 'member' = 'member',
  ): Promise<OrgInvite> {
    return this.request<OrgInvite>('POST', '/org/invite', { email, role });
  }

  async listMyInvites(): Promise<OrgInvite[]> {
    return (await this.requestPage<OrgInvite>('GET', '/org/invites')).items;
  }

  async acceptInvite(orgId: string): Promise<OrgMember> {
    return this.request<OrgMember>('POST', `/org/invites/${encodeURIComponent(orgId)}/accept`, {});
  }

  async declineInvite(orgId: string): Promise<{ declined: boolean }> {
    return this.request<{ declined: boolean }>('POST', `/org/invites/${encodeURIComponent(orgId)}/decline`, {});
  }

  async removeMember(email: string): Promise<{ removed: boolean }> {
    return this.request<{ removed: boolean }>(
      'DELETE',
      `/org/members/${encodeURIComponent(email)}`,
    );
  }

  // --- Bucket config (BYO-bucket) ---

  async listBucketConfigs(cursor?: string): Promise<PagedResponse<BucketConfig>> {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.requestPage<BucketConfig>('GET', `/bucket-config${qs}`);
  }

  async getBucketConfig(id: string): Promise<BucketConfig> {
    return this.request<BucketConfig>('GET', `/bucket-config/${encodeURIComponent(id)}`);
  }

  async createBucketConfig(input: CreateBucketConfigInput): Promise<BucketConfig> {
    return this.request<BucketConfig>('POST', '/bucket-config', input);
  }

  async verifyBucketConfig(id: string): Promise<BucketConfig> {
    return this.request<BucketConfig>(
      'POST',
      `/bucket-config/${encodeURIComponent(id)}/verify`,
      {},
    );
  }

  async deleteBucketConfig(id: string): Promise<{ deleted: boolean }> {
    return this.request<{ deleted: boolean }>(
      'DELETE',
      `/bucket-config/${encodeURIComponent(id)}`,
    );
  }

  // --- API keys ---

  async listApiKeys(cursor?: string): Promise<PagedResponse<ApiKeyRecord>> {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.requestPage<ApiKeyRecord>('GET', `/keys${qs}`);
  }

  async createApiKey(name: string): Promise<CreatedApiKey> {
    return this.request<CreatedApiKey>('POST', '/keys', { name });
  }

  async revokeApiKey(keyId: string): Promise<{ revoked: boolean }> {
    return this.request<{ revoked: boolean }>(
      'DELETE',
      `/keys/${encodeURIComponent(keyId)}`,
    );
  }

  // --- Share links ---

  async listShares(workspaceId: string, cursor?: string): Promise<PagedResponse<ShareTokenMeta>> {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.requestPage<ShareTokenMeta>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/share${qs}`);
  }

  async createShare(
    workspaceId: string,
    body: { permission: 'view' | 'comment' | 'edit'; file_id?: string; email?: string; expires_in?: number; max_uses?: number },
  ): Promise<CreatedShare> {
    return this.request<CreatedShare>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/share`, body);
  }

  async revokeShare(workspaceId: string, tokenId: string): Promise<{ revoked: boolean }> {
    return this.request<{ revoked: boolean }>(
      'DELETE',
      `/workspaces/${encodeURIComponent(workspaceId)}/share/${encodeURIComponent(tokenId)}`,
    );
  }

  // --- Org settings ---

  async updateOrg(name: string): Promise<OrgDetail> {
    return this.request<OrgDetail>('PATCH', '/org', { name });
  }
}

export const apiClient = new ApiClient();
