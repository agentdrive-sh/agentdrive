// AgentDrive TypeScript SDK.
//
// One client class, every tool surface. Mirrors the MCP server's tool shape so
// any agent that can run TS can talk to AgentDrive without going through MCP
// stdio. The same `X-Agent-Platform` / `X-Agent-Role` identity model applies —
// pass them at construction time and every request gets stamped.
//
// Errors throw `ApiError` carrying the HTTP status so callers can branch
// (e.g. 404 vs 403 vs 429).

export interface AgentDriveConfig {
  /** Base URL of the AgentDrive worker. Defaults to https://app.agentdrive.sh */
  baseUrl?: string;
  /** API key, e.g. `agentdrive_live_...`. Required for any agent-auth path. */
  apiKey: string;
  /** Logical platform name (`claude-code`, `codex`, `cursor`, `langgraph`, `crewai`, `mcp`, `cli`, etc.). */
  agentPlatform?: string;
  /** Free-text role label, max 64 chars on the server. */
  agentRole?: string;
}

export interface PagedResponse<T> {
  items: T[];
  cursor: string | null;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

type ListPageFetcher<T> = (cursor: string | null) => Promise<PagedResponse<T>>;

/** Walk a paged list endpoint to exhaustion, capped at maxPages to prevent runaway loops. */
export async function listAllPages<T>(fetchPage: ListPageFetcher<T>, maxPages = 10): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(cursor);
    all.push(...page.items);
    if (!page.cursor) return all;
    cursor = page.cursor;
  }
  return all;
}

// --- Result types (kept in sync with apps/worker response shapes) ---

export interface SearchHit {
  path: string;
  ws_id: string;
  content_hash: string;
  score: number | null;
  snippet?: string;
  agent_id: string;
  agent_platform: string;
  created_at: number;
  chunk_idx?: number;
  match_kind?: 'semantic' | 'keyword';
}

export interface ContextArtifact extends SearchHit {}

export interface SearchFilterInput {
  agent_platform?: string;
  agent_id?: string;
  path_prefix?: string;
  kind?: string;
}

export interface SearchRequestBody {
  query: string;
  workspace_id?: string;
  top_k?: number;
  filter?: SearchFilterInput;
}

export interface ContextRequestBody {
  task: string;
  workspace_id?: string;
  limit?: number;
}

export type RunStatus = 'success' | 'failure' | 'partial' | 'in_progress';

export interface RunRequestBody {
  task: string;
  status: RunStatus;
  run_id?: string;
  artifacts_referenced?: string[];
  artifacts_produced?: string[];
  duration_ms?: number;
  metadata?: Record<string, unknown>;
}

export interface FileSummary {
  id: string;
  path: string;
  version: number;
  size: number;
  updated_at: string;
}

export interface FileContent {
  id: string;
  path: string;
  content: string;
  version: number;
  updated_at: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  created_at: string;
}

export interface FileVersion {
  version: number;
  actor_type: string;
  actor_id: string;
  created_at: string;
  message?: string;
}

export interface Comment {
  id: string;
  body: string;
  author_type: string;
  author_id: string;
  author_name?: string;
  created_at: string;
  line_start?: number;
  line_end?: number;
}

export interface ActivityEvent {
  id: string;
  action: string;
  actor_type: string;
  actor_id: string;
  target_path?: string;
  created_at: string;
}

export interface ShareLink {
  token_id: string;
  url: string;
  permission: string;
  email_gated: boolean;
  expires_at?: string;
}

const DEFAULT_BASE_URL = 'https://app.agentdrive.sh';

/**
 * The canonical TypeScript client for AgentDrive.
 *
 * @example
 * ```ts
 * const drive = new AgentDrive({
 *   apiKey: process.env.AGENTDRIVE_API_KEY!,
 *   agentPlatform: 'codex',
 *   agentRole: 'planner',
 * });
 * await drive.writeFile(workspaceId, 'plan.md', '# the plan');
 * const ctx = await drive.context({ task: 'implement plan.md', limit: 5 });
 * ```
 */
export class AgentDrive {
  private baseUrl: string;
  private apiKey: string;
  private agentPlatform: string;
  private agentRole: string;

  constructor(config: AgentDriveConfig) {
    if (!config.apiKey) throw new Error('AgentDrive: apiKey is required');
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.agentPlatform = config.agentPlatform ?? 'sdk-ts';
    this.agentRole = config.agentRole ?? '';
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'X-Agent-Platform': this.agentPlatform,
      'X-Agent-Role': this.agentRole,
    };
  }

  /** Escape hatch for unwrapped fetch — same auth/headers, full Response in your hands. */
  async rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const url = `${this.baseUrl}/v1${path}`;
    return fetch(url, {
      ...init,
      headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) },
    });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.rawFetch(path, {
      method,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json: { success: boolean; data?: T; error?: string };
    try {
      json = (await res.json()) as { success: boolean; data?: T; error?: string };
    } catch {
      throw new ApiError(`Invalid JSON response (${res.status})`, res.status);
    }
    if (!res.ok || !json.success) {
      throw new ApiError(json.error ?? `API request failed (${res.status})`, res.status);
    }
    return json.data as T;
  }

  private async requestPage<T>(method: string, path: string, body?: unknown): Promise<PagedResponse<T>> {
    const res = await this.rawFetch(path, {
      method,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json()) as {
      success: boolean;
      data?: T[];
      cursor?: string | null;
      error?: string;
    };
    if (!res.ok || !json.success) {
      throw new ApiError(json.error ?? `API request failed (${res.status})`, res.status);
    }
    return { items: (json.data ?? []) as T[], cursor: json.cursor ?? null };
  }

  // --- Workspaces ---

  async createWorkspace(name: string): Promise<WorkspaceSummary> {
    return this.request<WorkspaceSummary>('POST', '/workspaces', { name });
  }

  async listWorkspacesPage(cursor: string | null = null): Promise<PagedResponse<WorkspaceSummary>> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.requestPage<WorkspaceSummary>('GET', `/workspaces${query}`);
  }

  async listWorkspaces(maxPages = 10): Promise<WorkspaceSummary[]> {
    return listAllPages((cursor) => this.listWorkspacesPage(cursor), maxPages);
  }

  // --- Files ---

  async writeFile(workspaceId: string, path: string, content: string, message?: string) {
    return this.request<{
      id: string;
      workspace_id: string;
      path: string;
      version: number;
      created_at: string;
      updated_at: string;
    }>('POST', `/workspaces/${workspaceId}/files`, { path, content, message });
  }

  async readFile(workspaceId: string, fileId: string): Promise<FileContent> {
    return this.request<FileContent>('GET', `/workspaces/${workspaceId}/files/${fileId}?content=true`);
  }

  async listFilesPage(workspaceId: string, prefix?: string, cursor: string | null = null): Promise<PagedResponse<FileSummary>> {
    const params = new URLSearchParams();
    if (prefix) params.set('prefix', prefix);
    if (cursor) params.set('cursor', cursor);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.requestPage<FileSummary>('GET', `/workspaces/${workspaceId}/files${query}`);
  }

  async listAllFiles(workspaceId: string, prefix?: string, maxPages = 10): Promise<FileSummary[]> {
    return listAllPages((cursor) => this.listFilesPage(workspaceId, prefix, cursor), maxPages);
  }

  async deleteFile(workspaceId: string, fileId: string): Promise<{ deleted: boolean }> {
    return this.request<{ deleted: boolean }>('DELETE', `/workspaces/${workspaceId}/files/${fileId}`);
  }

  async getVersionsPage(workspaceId: string, fileId: string, cursor: string | null = null): Promise<PagedResponse<FileVersion>> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.requestPage<FileVersion>('GET', `/workspaces/${workspaceId}/files/${fileId}/versions${query}`);
  }

  async getAllVersions(workspaceId: string, fileId: string, maxPages = 10): Promise<FileVersion[]> {
    return listAllPages((cursor) => this.getVersionsPage(workspaceId, fileId, cursor), maxPages);
  }

  // --- Memory / retrieval ---

  async search(body: SearchRequestBody): Promise<{ hits: SearchHit[]; total: number }> {
    return this.request<{ hits: SearchHit[]; total: number }>('POST', '/search', body);
  }

  async context(body: ContextRequestBody): Promise<{ artifacts: ContextArtifact[]; retrieved_at: number }> {
    return this.request<{ artifacts: ContextArtifact[]; retrieved_at: number }>('POST', '/context', body);
  }

  // --- Runs / provenance ---

  async logRun(body: RunRequestBody): Promise<{ run_id: string; created_at: number }> {
    return this.request<{ run_id: string; created_at: number }>('POST', '/runs', body);
  }

  async getRun(runId: string) {
    return this.request<unknown>('GET', `/runs/${encodeURIComponent(runId)}`);
  }

  // --- Sharing / comments / activity ---

  async createShareLink(
    workspaceId: string,
    permission: 'view' | 'comment' | 'edit',
    fileId?: string,
    expiresIn?: number,
    maxUses?: number,
    email?: string,
  ): Promise<ShareLink> {
    return this.request<ShareLink>('POST', `/workspaces/${workspaceId}/share`, {
      permission,
      file_id: fileId,
      expires_in: expiresIn,
      max_uses: maxUses,
      email,
    });
  }

  async addComment(
    workspaceId: string,
    fileId: string,
    body: string,
    authorName?: string,
    lineStart?: number,
    lineEnd?: number,
  ): Promise<Comment> {
    return this.request<Comment>('POST', `/workspaces/${workspaceId}/files/${fileId}/comments`, {
      body,
      author_name: authorName,
      line_start: lineStart,
      line_end: lineEnd,
    });
  }

  async getCommentsPage(workspaceId: string, fileId: string, cursor: string | null = null): Promise<PagedResponse<Comment>> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.requestPage<Comment>('GET', `/workspaces/${workspaceId}/files/${fileId}/comments${query}`);
  }

  async getAllComments(workspaceId: string, fileId: string, maxPages = 10): Promise<Comment[]> {
    return listAllPages((cursor) => this.getCommentsPage(workspaceId, fileId, cursor), maxPages);
  }

  async getActivityPage(workspaceId: string, cursor: string | null = null): Promise<PagedResponse<ActivityEvent>> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.requestPage<ActivityEvent>('GET', `/workspaces/${workspaceId}/activity${query}`);
  }

  async getAllActivity(workspaceId: string, maxPages = 10): Promise<ActivityEvent[]> {
    return listAllPages((cursor) => this.getActivityPage(workspaceId, cursor), maxPages);
  }

  // --- Roles / org ---

  async assignRole(workspaceId: string, email: string, permission: 'view' | 'comment' | 'edit') {
    return this.request<{
      workspace_id: string;
      email: string;
      permission: string;
      assigned_at: string;
    }>('POST', `/workspaces/${workspaceId}/roles`, { email, permission });
  }

  async getRolesPage(workspaceId: string, cursor: string | null = null) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.requestPage<{
      email: string;
      permission: string;
      assigned_by: string;
      assigned_at: string;
    }>('GET', `/workspaces/${workspaceId}/roles${query}`);
  }

  async getAllRoles(workspaceId: string, maxPages = 10) {
    return listAllPages((cursor) => this.getRolesPage(workspaceId, cursor), maxPages);
  }

  async removeRole(workspaceId: string, email: string) {
    return this.request<{ deleted: boolean }>(
      'DELETE',
      `/workspaces/${workspaceId}/roles/${encodeURIComponent(email)}`,
    );
  }

  async inviteMember(email: string, role: 'owner' | 'admin' | 'member' = 'member') {
    return this.request<{ org_id: string; email: string; role: string }>('POST', '/org/invite', {
      email,
      role,
    });
  }

  async getOrg(maxPages = 10) {
    // Org returns agents + members each with its own cursor; loop both to exhaustion.
    const first = await this.fetchOrgPage(undefined, undefined);
    const agents = [...first.agents];
    const members = [...first.members];
    let agentsCursor = first.agents_cursor ?? undefined;
    let membersCursor = first.members_cursor ?? undefined;
    for (let i = 1; i < maxPages && agentsCursor; i++) {
      const page = await this.fetchOrgPage(agentsCursor, undefined);
      agents.push(...page.agents);
      agentsCursor = page.agents_cursor ?? undefined;
    }
    for (let i = 1; i < maxPages && membersCursor; i++) {
      const page = await this.fetchOrgPage(undefined, membersCursor);
      members.push(...page.members);
      membersCursor = page.members_cursor ?? undefined;
    }
    return {
      ...first.org,
      agents,
      members,
      usage: first.usage,
      quota: first.quota,
    };
  }

  private async fetchOrgPage(
    agentsCursor: string | undefined,
    membersCursor: string | undefined,
  ): Promise<{
    org: { id: string; name: string; plan: string };
    agents: Array<{ agent_id: string; agent_name?: string; agent_email?: string }>;
    members: Array<{ email: string; role: string }>;
    agents_cursor: string | null;
    members_cursor: string | null;
    usage: { storage_bytes: number; agent_count: number; workspace_count: number; member_count: number };
    quota: { storage_bytes: number | null; max_agents: number | null; max_workspaces: number | null; max_human_seats: number | null };
  }> {
    const params = new URLSearchParams();
    if (agentsCursor) params.set('agents_cursor', agentsCursor);
    if (membersCursor) params.set('members_cursor', membersCursor);
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await this.rawFetch(`/org${query}`, { method: 'GET' });
    const json = (await res.json()) as {
      success: boolean;
      data?: {
        id: string;
        name: string;
        plan: string;
        agents: Array<{ agent_id: string; agent_name?: string; agent_email?: string }>;
        members: Array<{ email: string; role: string }>;
        usage: { storage_bytes: number; agent_count: number; workspace_count: number; member_count: number };
        quota: { storage_bytes: number | null; max_agents: number | null; max_workspaces: number | null; max_human_seats: number | null };
      };
      agents_cursor?: string | null;
      members_cursor?: string | null;
      error?: string;
    };
    if (!res.ok || !json.success || !json.data) {
      throw new ApiError(json.error ?? `API request failed (${res.status})`, res.status);
    }
    const { agents, members, usage, quota, ...org } = json.data;
    return {
      org,
      agents,
      members,
      usage,
      quota,
      agents_cursor: json.agents_cursor ?? null,
      members_cursor: json.members_cursor ?? null,
    };
  }

  async getBillingPlan() {
    return this.request<{
      plan: string;
      trial_ends_at?: string;
      usage: Record<string, number>;
      quota: Record<string, number>;
    }>('GET', '/billing/plan');
  }

  // --- Sandbox ---

  async sandboxClone(workspaceId: string, body: { url: string; branch?: string; depth?: number }) {
    return this.request<{
      workspace_id: string;
      repo_url?: string;
      branch?: string;
      head_sha?: string;
      last_active_at?: number;
    }>('POST', `/workspaces/${workspaceId}/sandbox/clone`, body);
  }

  async sandboxExec(workspaceId: string, body: { cmd: string; cwd?: string; timeout_ms?: number }) {
    return this.request<{
      exit_code: number;
      stdout: string;
      stderr: string;
      duration_ms: number;
      truncated: boolean;
    }>('POST', `/workspaces/${workspaceId}/sandbox/exec`, body);
  }

  async sandboxRead(workspaceId: string, path: string) {
    const cleaned = path.startsWith('/') ? path : `/${path}`;
    return this.request<{ content: string; size: number; truncated: boolean }>(
      'GET',
      `/workspaces/${workspaceId}/sandbox/files${cleaned}`,
    );
  }

  async sandboxCommit(workspaceId: string, body: { message: string; author?: { name: string; email: string } }) {
    return this.request<{
      commit_sha: string;
      branch: string;
      files_changed: number;
      artifact_path: string;
    }>('POST', `/workspaces/${workspaceId}/sandbox/commit`, body);
  }
}
