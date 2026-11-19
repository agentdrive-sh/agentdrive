export interface CliApiClientConfig {
  baseUrl: string;
  apiKey?: string;
  agentPlatform?: string;
  agentRole?: string;
}

export interface UsageWarning {
  metric?: string;
  level: string;
  message: string;
  upgrade_url: string;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  cursor?: string | null;
  error?: string;
  code?: string;
  upgrade_url?: string;
  usage_warning?: UsageWarning;
}

export interface PagedResponse<T> {
  items: T[];
  cursor: string | null;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  created_at: string;
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
  usage_warning?: UsageWarning;
}

export interface SearchHit {
  path: string;
  ws_id: string;
  content_hash: string;
  score: number | null;
  snippet?: string;
  agent_id: string;
  agent_platform: string;
  created_at: number;
}

export interface RunRecord {
  run_id: string;
  workspace_id?: string;
  agent_platform: string;
  task: string;
  status: string;
  artifacts_produced: string[];
  metadata: Record<string, unknown>;
  created_at: number;
  updated_at?: number;
}

export interface CliAuthStart {
  auth_url: string;
  id: string;
  // Typed by the user on the sign-in page; never part of auth_url.
  user_code: string;
  // The poll secret. Only this process holds it, so a leaked auth_url cannot collect the key.
  device_code: string;
  expires_in: number;
}

export type CliAuthPoll =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'denied'; error: string }
  | { status: 'complete'; api_key: string; agent_id?: string; org_id?: string }
  | { status: 'refused'; error: string; upgrade_url: string };

export interface BillingPortal {
  url: string;
}

export interface MetricStatus {
  used: number;
  limit: number;
  pct: number;
  level: string;
}

export interface UsageStatus {
  plan_name: string;
  level: string;
  message?: string;
  upgrade_url: string;
  metrics: Record<string, MetricStatus>;
}

export interface BillingPlan {
  plan: string;
  usage: Record<string, number>;
  quota: Record<string, number>;
  status?: UsageStatus;
}

export interface AuthProviders {
  google: boolean;
  github: boolean;
  email: boolean;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  upgradeUrl?: string;
  constructor(message: string, status: number, code?: string, upgradeUrl?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.upgradeUrl = upgradeUrl;
    this.name = 'ApiError';
  }
}

function retryAfterMs(res: Response): number {
  const seconds = Number(res.headers.get('Retry-After'));
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 10) * 1000;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class CliApiClient {
  private baseUrl: string;
  private apiKey?: string;
  private agentPlatform: string;
  private agentRole: string;

  constructor(config: CliApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.agentPlatform = config.agentPlatform ?? 'cli';
    this.agentRole = config.agentRole ?? '';
  }

  private headers(authRequired: boolean): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Agent-Platform': this.agentPlatform,
      'X-Agent-Role': this.agentRole,
    };
    if (authRequired && this.apiKey) {
      h['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  // A request with a timeout only waits out a 429 when the wait fits inside it, so short hooks never stall.
  // `perRequestMs` instead bounds each attempt on its own, so a long Retry-After still gets its retry.
  // `beforeRetry` false: the request is not worth repeating any more, so the 429 stands.
  private async send(method: string, path: string, body: unknown, authRequired: boolean, timeoutMs?: number, beforeRetry?: () => Promise<boolean>, perRequestMs?: number): Promise<Response> {
    const url = `${this.baseUrl}/v1${path}`;
    const deadline = timeoutMs === undefined ? Infinity : Date.now() + timeoutMs;
    const overall = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs);
    const init = (): RequestInit => ({
      method,
      headers: this.headers(authRequired),
      body: body ? JSON.stringify(body) : undefined,
      signal: overall ?? (perRequestMs === undefined ? undefined : AbortSignal.timeout(perRequestMs)),
    });
    let res = await fetch(url, init());
    if (res.status === 429 && Date.now() + retryAfterMs(res) < deadline) {
      await sleep(retryAfterMs(res), overall);
      if (!beforeRetry || (await beforeRetry())) res = await fetch(url, init());
    }
    if (res.status !== 429) return res;
    const seconds = retryAfterMs(res) / 1000;
    throw new ApiError(`AgentDrive is rate limiting this key; try again in ${seconds} seconds.`, 429, 'rate_limited');
  }

  private async request<T>(method: string, path: string, body?: unknown, authRequired = true, timeoutMs?: number, beforeRetry?: () => Promise<boolean>, perRequestMs?: number): Promise<T> {
    const res = await this.send(method, path, body, authRequired, timeoutMs, beforeRetry, perRequestMs);
    let json: ApiEnvelope<T>;
    try {
      json = await res.json() as ApiEnvelope<T>;
    } catch {
      throw new ApiError(`Invalid JSON response (status ${res.status})`, res.status);
    }
    if (!res.ok || !json.success) {
      throw new ApiError(json.error ?? `Request failed (${res.status})`, res.status, json.code, json.upgrade_url);
    }
    return (json.usage_warning ? { ...json.data, usage_warning: json.usage_warning } : json.data) as T;
  }

  private async requestPage<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<PagedResponse<T>> {
    const res = await this.send(method, path, body, true, timeoutMs);
    const json = await res.json() as ApiEnvelope<T[]>;
    if (!res.ok || !json.success) {
      throw new ApiError(json.error ?? `Request failed (${res.status})`, res.status);
    }
    return { items: (json.data ?? []) as T[], cursor: json.cursor ?? null };
  }

  async startCliAuth(): Promise<CliAuthStart> {
    return this.request<CliAuthStart>('POST', '/auth/cli/start', { shows_user_code: true }, false);
  }

  async pollCliAuth(start: CliAuthStart): Promise<CliAuthPoll> {
    return this.request<CliAuthPoll>('POST', '/auth/cli/poll', { id: start.id, device_code: start.device_code }, false);
  }

  async getAuthProviders(): Promise<AuthProviders> {
    return this.request<AuthProviders>('GET', '/auth/providers', undefined, false);
  }

  async whoami(): Promise<unknown> {
    // /v1/auth/me is the canonical principal endpoint; fall back to /v1/org if the worker hasn't shipped it.
    try {
      return await this.request<unknown>('GET', '/auth/me');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return await this.request<unknown>('GET', '/org');
      }
      throw err;
    }
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    const all: WorkspaceSummary[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const url: string = cursor ? `/workspaces?cursor=${encodeURIComponent(cursor)}` : '/workspaces';
      const page: PagedResponse<WorkspaceSummary> = await this.requestPage<WorkspaceSummary>('GET', url);
      all.push(...page.items);
      if (!page.cursor) return all;
      cursor = page.cursor;
    }
    return all;
  }

  async createWorkspace(name: string): Promise<WorkspaceSummary> {
    return this.request<WorkspaceSummary>('POST', '/workspaces', { name });
  }

  async writeFile(workspaceId: string, path: string, content: string, message?: string, beforeRetry?: () => Promise<boolean>, perRequestMs?: number) {
    return this.request<{ id: string; path: string; version: number; updated_at: string; usage_warning?: UsageWarning }>(
      'POST',
      `/workspaces/${workspaceId}/files`,
      { path, content, message },
      true,
      undefined,
      beforeRetry,
      perRequestMs,
    );
  }

  async readFileByPath(workspaceId: string, path: string): Promise<FileContent> {
    const files = await this.requestPage<FileSummary>(
      'GET',
      `/workspaces/${workspaceId}/files?prefix=${encodeURIComponent(path)}`,
    );
    const match = files.items.find((f) => f.path === path);
    if (!match) throw new ApiError(`File not found: ${path}`, 404);
    return this.request<FileContent>('GET', `/workspaces/${workspaceId}/files/${match.id}?content=true`);
  }

  async search(body: { query: string; workspace_id?: string; top_k?: number; filter?: Record<string, string> }) {
    return this.request<{ hits: SearchHit[]; total: number }>('POST', '/search', body);
  }

  async context(body: { task: string; workspace_id?: string; limit?: number }) {
    return this.request<{ artifacts: SearchHit[]; retrieved_at: number }>('POST', '/context', body);
  }

  async logRun(body: {
    task: string;
    status: 'success' | 'failure' | 'partial' | 'in_progress';
    run_id?: string;
    workspace_id?: string;
    artifacts_referenced?: string[];
    artifacts_produced?: string[];
    duration_ms?: number;
    metadata?: Record<string, unknown>;
  }, beforeRetry?: () => Promise<boolean>) {
    return this.request<{ run_id: string; created_at: number; usage_warning?: UsageWarning }>('POST', '/runs', body, true, undefined, beforeRetry);
  }

  async listRuns(query: { project: string; platform?: string; limit?: number; timeoutMs?: number }): Promise<RunRecord[]> {
    const params = new URLSearchParams({ project: query.project });
    if (query.platform) params.set('platform', query.platform);
    if (query.limit) params.set('limit', String(query.limit));
    return (await this.requestPage<RunRecord>('GET', `/runs?${params.toString()}`, undefined, query.timeoutMs)).items;
  }

  async getRun(runId: string): Promise<RunRecord> {
    return this.request<RunRecord>('GET', `/runs/${encodeURIComponent(runId)}`);
  }

  async billingPortal(): Promise<BillingPortal> {
    return this.request<BillingPortal>('POST', '/billing/portal', {});
  }

  async billingPlan(timeoutMs?: number): Promise<BillingPlan> {
    return this.request<BillingPlan>('GET', '/billing/plan', undefined, true, timeoutMs);
  }

  async timeline(opts: { since?: string; limit?: number } = {}): Promise<{
    items: TimelineEvent[];
    truncated: boolean;
  }> {
    const params = new URLSearchParams();
    if (opts.since) params.set('since', opts.since);
    if (typeof opts.limit === 'number') params.set('limit', String(opts.limit));
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await this.send('GET', `/org/timeline${query}`, undefined, true);
    const json = (await res.json()) as ApiEnvelope<TimelineEvent[]> & { truncated?: boolean };
    if (!res.ok || !json.success) {
      throw new Error(json.error ?? `API request failed (${res.status})`);
    }
    return { items: (json.data ?? []) as TimelineEvent[], truncated: !!json.truncated };
  }
}

export interface TimelineEvent {
  id: string;
  workspace_id: string;
  actor_type: 'agent' | 'human';
  actor_id: string;
  agent_platform?: string;
  action: string;
  target_type: string;
  target_id: string;
  target_path?: string;
  created_at: string;
}
