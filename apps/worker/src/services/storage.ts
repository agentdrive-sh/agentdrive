import {
  hashContent, generateId, invertTimestamp, padVersion,
  DEFAULT_STORAGE_LOCATOR, defaultObjectKey,
} from '@agentdrive/shared';
import { R2DefaultDriver } from './bucket-driver/r2-default.js';
import { resolveDriverForRead, resolveDriverForWrite } from './bucket-driver/resolve.js';
import type { BucketDriver } from './bucket-driver/types.js';
import { BucketConfigStore } from './bucket-config.js';
import type {
  FileMeta, FileVersion, WorkspaceMeta, ActivityEvent, Comment,
  OrgMeta, OrgMember, OrgInvite, OrgAgent, SessionMeta, RoleAssignment,
  ActivityAction, ActivityTarget, Paginated,
  OAuthProvider, ProviderLinkedUser, ApiKeyMeta, ApiKeyRecord, ShareTokenMeta,
} from '@agentdrive/shared';
import type { Env } from '../env.js';
import { HTTPException } from 'hono/http-exception';
import { REGISTRATION_CLOSED, selfHosted } from '../lib/self-hosted.js';
import {
  chunkText,
  chunkCountFor,
  upsertFileEmbeddings,
  deleteEmbedding,
  deleteFileEmbeddings,
  type EmbeddingMetadata,
} from './embeddings.js';

interface WaitUntilCtx {
  waitUntil(p: Promise<unknown>): void;
}

const DEFAULT_PAGE_SIZE = 50;

export interface Usage {
  storage_bytes: number;
  embedding_count: number;
  agent_count: number;
  workspace_count: number;
  member_count: number;
}

const EMPTY_USAGE: Usage = { storage_bytes: 0, embedding_count: 0, agent_count: 0, workspace_count: 0, member_count: 0 };
export const ORG_INVITE_TTL_SECONDS = 14 * 24 * 60 * 60;
const XRESUME_TTL_SECONDS = 400 * 24 * 60 * 60;
// Outlives the month in the key, so a marker never expires mid-month.
const RESUME_MARKER_TTL_SECONDS = 40 * 24 * 60 * 60;

export function resumeMonth(d: Date): string {
  return d.toISOString().slice(0, 7);
}

// One resume-meter marker per session and reading harness per UTC month; the
// hash keeps project names out of the key.
export async function resumeMarkerKey(orgId: string, month: string, path: string, to: string): Promise<string> {
  return `xresume_m:${orgId}:${month}:${(await hashContent(`${path}|${to}`)).slice(0, 32)}`;
}

// Mirrored in scripts/weekly-metrics.ts (node cannot load the worker's
// .js-suffixed imports); the weekly-metrics test holds the two together.
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export class StorageService {
  // Phase 4: storage operations go through a BucketDriver instead of raw
  // env.R2 so future BYO-bucket configs can route to a customer R2 or S3
  // bucket per FileMeta.bucket_config_id. v1 always uses the default
  // driver (wraps the AgentDrive R2 bucket). Future call sites that need
  // to read a non-default-locator file will swap this for
  // resolveBucketTarget(env, meta, hash).
  private defaultDriver: BucketDriver;

  constructor(
    private kv: KVNamespace,
    private r2: R2Bucket,
  ) {
    this.defaultDriver = new R2DefaultDriver(r2);
  }

  // --- Workspace ---

  async getWorkspace(wid: string): Promise<WorkspaceMeta | null> {
    return this.kv.get<WorkspaceMeta>(`ws:${wid}`, 'json');
  }

  async createWorkspace(wid: string, name: string, createdBy: string, orgId?: string): Promise<WorkspaceMeta> {
    const ws: WorkspaceMeta = {
      id: wid,
      name,
      org_id: orgId,
      created_at: new Date().toISOString(),
      created_by: createdBy,
      agent_count: 1,
    };
    await this.kv.put(`ws:${wid}`, JSON.stringify(ws));
    if (orgId) {
      await this.kv.put(`idx:org_workspaces:${orgId}:${wid}`, wid);
    }
    return ws;
  }

  // MIGRATION: now returns Paginated<WorkspaceMeta>. Top-level handler exposes
  // items as `data` and adds `cursor` as a response sibling.
  async listWorkspaces(orgId: string, cursor?: string): Promise<Paginated<WorkspaceMeta>> {
    const list = await this.kv.list({ prefix: `idx:org_workspaces:${orgId}:`, limit: DEFAULT_PAGE_SIZE, cursor });
    // Two-stage parallel fetch: index keys → ws ids → ws meta. Drops the
    // 1 + 2N sequential round-trip pattern down to roughly 2 round-trips.
    const wids = await Promise.all(list.keys.map((k) => this.kv.get(k.name)));
    const metas = await Promise.all(
      wids
        .filter((w): w is string => Boolean(w))
        .map((w) => this.getWorkspace(w)),
    );
    const workspaces = metas.filter((m): m is WorkspaceMeta => m !== null);
    return { items: workspaces, cursor: list.list_complete ? null : list.cursor };
  }

  // --- Files ---

  // env/ctx/embedOpts are optional so tests can call writeFile without binding
  // up Workers AI + Vectorize. In production callers must pass them or the
  // embedding upsert may abort mid-flight when the response is sent.
  async writeFile(
    wid: string,
    path: string,
    content: string,
    actorType: 'agent' | 'human',
    actorId: string,
    message?: string,
    env?: Env,
    ctx?: WaitUntilCtx,
    embedOpts?: { agent_platform?: string; org_id?: string; mime?: string },
  ): Promise<FileMeta> {
    const contentHash = await hashContent(content);
    const encoder = new TextEncoder();
    const size = encoder.encode(content).length;

    // Phase 4 — writes go through resolveDriverForWrite which honors the
    // workspace's bucket_config_id. The locator stamped onto FileMeta below
    // captures the write's actual destination so future reads route to the
    // right bucket even after the workspace switches its config.
    //
    // When env is unset (legacy/test callers that constructed StorageService
    // without a worker context) we fall back to the default driver. Route
    // handlers always pass env so production writes always honor the
    // configured bucket.
    let writeDriver: BucketDriver;
    let writeLocator: { bucket_config_id: string; provider: typeof DEFAULT_STORAGE_LOCATOR.provider; object_key: string; key_version: number };
    if (env) {
      const ws = await this.kv.get<WorkspaceMeta>(`ws:${wid}`, 'json');
      if (ws) {
        const resolved = await resolveDriverForWrite(env, ws, contentHash);
        writeDriver = resolved.driver;
        writeLocator = resolved.locator;
      } else {
        writeDriver = this.defaultDriver;
        writeLocator = {
          bucket_config_id: DEFAULT_STORAGE_LOCATOR.bucket_config_id,
          provider: DEFAULT_STORAGE_LOCATOR.provider,
          object_key: defaultObjectKey(contentHash),
          key_version: DEFAULT_STORAGE_LOCATOR.key_version,
        };
      }
    } else {
      writeDriver = this.defaultDriver;
      writeLocator = {
        bucket_config_id: DEFAULT_STORAGE_LOCATOR.bucket_config_id,
        provider: DEFAULT_STORAGE_LOCATOR.provider,
        object_key: defaultObjectKey(contentHash),
        key_version: DEFAULT_STORAGE_LOCATOR.key_version,
      };
    }

    // Phase 4 fail-closed wrap: a customer-bucket write that throws marks
    // bucket_config.health=degraded so subsequent writes refuse at the
    // resolveDriverForWrite gate. A successful write auto-restores health
    // back to 'healthy' (the recovery path that pairs with /v1/bucket-config/
    // :id/verify). The default AgentDrive bucket has no config record to
    // flip, so the side-effect is skipped when bucket_config_id is 'default'.
    const isCustomerBucket =
      env !== undefined && writeLocator.bucket_config_id !== 'default';
    const orgIdForHealth =
      isCustomerBucket && env
        ? (await this.kv.get<WorkspaceMeta>(`ws:${wid}`, 'json'))?.org_id
        : undefined;

    try {
      const existing = await writeDriver.head(writeLocator.object_key);
      if (!existing) {
        await writeDriver.put(writeLocator.object_key, content, { contentType: 'text/markdown' });
      }
    } catch (err) {
      if (env && isCustomerBucket && orgIdForHealth) {
        const msg = err instanceof Error ? err.message : String(err);
        const store = new BucketConfigStore(env.KV);
        const markJob = store.markHealth(
          orgIdForHealth,
          writeLocator.bucket_config_id,
          'degraded',
          msg,
        );
        if (ctx) ctx.waitUntil(markJob.then(() => undefined));
        else void markJob;
      }
      throw err;
    }

    // Auto-recover: a successful write to a previously-degraded customer
    // bucket flips the health flag back to 'healthy'. Cheap KV read on the
    // hot path is the cost; the win is "owner fixes the credential, next
    // write self-heals" so they don't have to manually run /verify.
    if (env && isCustomerBucket && orgIdForHealth) {
      const store = new BucketConfigStore(env.KV);
      const recoveryJob = (async (): Promise<void> => {
        const current = await store.get(orgIdForHealth, writeLocator.bucket_config_id);
        if (current && current.health !== 'healthy') {
          await store.markHealth(orgIdForHealth, writeLocator.bucket_config_id, 'healthy');
        }
      })();
      if (ctx) ctx.waitUntil(recoveryJob);
      else void recoveryJob;
    }

    // Check if file already exists at this path
    const existingFileId = await this.kv.get(`idx:ws_files:${wid}:${path}`);
    const now = new Date().toISOString();

    let fileMeta: FileMeta;
    // Capture the previous content_hash BEFORE we overwrite the file:* key.
    // Codex F6 / Phase 0 deliverable #5: prior code re-read the key AFTER
    // overwrite at line ~180, so previousHash always matched the new hash
    // and the cleanup branch never fired, leaking content_refs + Vectorize
    // embeddings on every update. Reads now use the already-fetched `current`.
    let previousHash: string | undefined;
    let previousSize: number | undefined;

    // T-E1 storage locator: stamp the actual destination of the bytes we
    // just wrote so a future workspace switch can't strand them. The values
    // come from resolveDriverForWrite above; for legacy / no-env callers
    // they default to the AgentDrive bucket.
    const locator = writeLocator;

    if (existingFileId) {
      // Update existing file
      const current = await this.kv.get<FileMeta>(`file:${wid}:${existingFileId}`, 'json');
      previousHash = current?.content_hash;
      previousSize = current?.size;
      const newVersion = current ? current.version + 1 : 1;

      fileMeta = {
        id: existingFileId,
        workspace_id: wid,
        path,
        content_hash: contentHash,
        size,
        mime_type: 'text/markdown',
        version: newVersion,
        created_at: current?.created_at ?? now,
        updated_at: now,
        created_by: current?.created_by ?? actorId,
        updated_by: actorId,
        ...locator,
      };

      // Store version record
      const version: FileVersion = {
        version: newVersion,
        content_hash: contentHash,
        size,
        actor_type: actorType,
        actor_id: actorId,
        created_at: now,
        message,
        ...locator,
      };
      await this.kv.put(`ver:${existingFileId}:${padVersion(newVersion)}`, JSON.stringify(version));
    } else {
      // New file
      const fileId = generateId('f');

      fileMeta = {
        id: fileId,
        workspace_id: wid,
        path,
        content_hash: contentHash,
        size,
        mime_type: 'text/markdown',
        version: 1,
        created_at: now,
        updated_at: now,
        created_by: actorId,
        updated_by: actorId,
        ...locator,
      };

      // Store version 1
      const version: FileVersion = {
        version: 1,
        content_hash: contentHash,
        size,
        actor_type: actorType,
        actor_id: actorId,
        created_at: now,
        message,
        ...locator,
      };
      await this.kv.put(`ver:${fileMeta.id}:${padVersion(1)}`, JSON.stringify(version));
    }

    // Store file metadata BEFORE the path index so a path-based read between
    // these two writes never returns 404 for a just-published file. T-E3:
    // sequential commit, never Promise.all-ed.
    await this.kv.put(`file:${wid}:${fileMeta.id}`, JSON.stringify(fileMeta));

    if (!existingFileId) {
      // Index: path → file ID. Last in the new-file commit chain so the
      // pointer only goes live once the canonical record exists.
      await this.kv.put(`idx:ws_files:${wid}:${path}`, fileMeta.id);
    }

    // Ref-counting index for orphan-vector cleanup. One entry per
    // (content_hash, wid, fid). On UPDATE that changes the hash, the old ref
    // is removed and the old hash's embeddings are dropped if no refs remain.
    // `previousHash` was captured above from the pre-overwrite `current` read.
    if (!existingFileId || previousHash !== contentHash) {
      await this.kv.put(`idx:content_refs:${contentHash}:${wid}:${fileMeta.id}`, '1');
      if (previousHash && previousHash !== contentHash) {
        await this.kv.delete(`idx:content_refs:${previousHash}:${wid}:${fileMeta.id}`);
        if (env) {
          const cleanupJob = Promise.all([
            deleteFileEmbeddings(env, previousHash, { org_id: embedOpts?.org_id ?? (await this.workspaceOrg(wid)) ?? '', ws_id: wid, path }),
            this.maybeDropEmbeddings(env, previousHash),
          ]);
          if (ctx) ctx.waitUntil(cleanupJob);
          else void cleanupJob;
        }
      }
    }

    if (env) {
      const baseMetadata: Omit<EmbeddingMetadata, 'chunk_idx' | 'chunk_text' | 'content_hash'> = {
        ws_id: wid,
        path,
        agent_id: actorId,
        agent_platform: embedOpts?.agent_platform,
        org_id: embedOpts?.org_id ?? '',
        mime: embedOpts?.mime ?? fileMeta.mime_type,
        created_at: Date.now(),
      };
      const chunks = chunkText(content);
      const embedJob = upsertFileEmbeddings(env, {
        contentHash,
        chunks,
        baseMetadata,
      });
      // fire-and-forget: without ctx the Worker may abort the embed before response flush
      if (ctx) ctx.waitUntil(embedJob);
      else void embedJob;
    }

    // Every version keeps its bytes; the new content's vectors replace the old ones.
    const meterOrg = await this.workspaceOrg(wid);
    if (meterOrg) {
      await this.incrementUsage(meterOrg, 'storage_bytes', size);
      await this.incrementUsage(meterOrg, 'embedding_count', chunkCountFor(size) - (existingFileId && previousSize !== undefined ? chunkCountFor(previousSize) : 0));
    }

    return fileMeta;
  }

  // Drop all embeddings for a content_hash IF no other file references it.
  // Called on file delete and on file update that changes content_hash.
  private async maybeDropEmbeddings(env: Env, contentHash: string): Promise<void> {
    const refs = await this.kv.list({
      prefix: `idx:content_refs:${contentHash}:`,
      limit: 1,
    });
    if (refs.keys.length === 0) {
      await deleteEmbedding(env, contentHash);
    }
  }

  async readFileContent(contentHash: string): Promise<string | null> {
    // Legacy path — used by callers that have only the content_hash (e.g.
    // the snippet fallback in /v1/context). Always hits the default
    // AgentDrive R2 bucket. Locator-aware callers should use
    // readFileContentForMeta() so files written into a BYO bucket are
    // resolved correctly.
    const obj = await this.defaultDriver.get(defaultObjectKey(contentHash));
    if (!obj) return null;
    return obj.text();
  }

  async readFileContentForMeta(env: Env, file: FileMeta): Promise<string | null> {
    // Locator-aware read. Uses the bucket recorded on the FileMeta so the
    // workspace can switch its bucket_config without breaking reads of
    // files written before the switch.
    const { driver, objectKey } = await resolveDriverForRead(env, file);
    const obj = await driver.get(objectKey);
    if (!obj) return null;
    return obj.text();
  }

  async getFile(wid: string, fid: string): Promise<FileMeta | null> {
    return this.kv.get<FileMeta>(`file:${wid}:${fid}`, 'json');
  }

  async getFileByPath(wid: string, path: string): Promise<FileMeta | null> {
    const fid = await this.kv.get(`idx:ws_files:${wid}:${path}`);
    if (!fid) return null;
    return this.getFile(wid, fid);
  }

  // MIGRATION: now returns Paginated<FileMeta>. Sorting is per-page; cross-page
  // ordering follows KV key order (path-prefix lexicographic), which is what
  // we want anyway.
  async listFiles(wid: string, prefix?: string, cursor?: string): Promise<Paginated<FileMeta>> {
    const listPrefix = `idx:ws_files:${wid}:${prefix ?? ''}`;
    const list = await this.kv.list({ prefix: listPrefix, limit: DEFAULT_PAGE_SIZE, cursor });

    const fids = await Promise.all(list.keys.map((k) => this.kv.get(k.name)));
    const metas = await Promise.all(
      fids
        .filter((f): f is string => Boolean(f))
        .map((f) => this.kv.get<FileMeta>(`file:${wid}:${f}`, 'json')),
    );
    const files = metas.filter((m): m is FileMeta => m !== null);

    return {
      items: files.sort((a, b) => a.path.localeCompare(b.path)),
      cursor: list.list_complete ? null : list.cursor,
    };
  }

  // Drops the file metadata + path index, drops its ref-count entry, and
  // schedules embedding cleanup if no other file references the same content.
  // env/ctx remain optional so tests can call without binding up Workers AI +
  // Vectorize; in production callers must pass them.
  async deleteFile(wid: string, fid: string, env?: Env, ctx?: WaitUntilCtx): Promise<boolean> {
    const meta = await this.getFile(wid, fid);
    if (!meta) return false;

    await Promise.all([
      this.kv.delete(`file:${wid}:${fid}`),
      this.kv.delete(`idx:ws_files:${wid}:${meta.path}`),
      this.kv.delete(`idx:content_refs:${meta.content_hash}:${wid}:${fid}`),
    ]);

    const meterOrg = await this.workspaceOrg(wid);
    if (meterOrg) {
      let bytes = 0;
      let cursor: string | undefined;
      do {
        const page = await this.getVersions(fid, cursor);
        bytes += page.items.reduce((sum, v) => sum + v.size, 0);
        cursor = page.cursor ?? undefined;
      } while (cursor);
      await this.incrementUsage(meterOrg, 'storage_bytes', -bytes);
      await this.incrementUsage(meterOrg, 'embedding_count', -chunkCountFor(meta.size));
    }

    if (env) {
      const cleanupJob = Promise.all([
        deleteFileEmbeddings(env, meta.content_hash, { org_id: meterOrg ?? '', ws_id: wid, path: meta.path }),
        this.maybeDropEmbeddings(env, meta.content_hash),
      ]);
      if (ctx) ctx.waitUntil(cleanupJob);
      else void cleanupJob;
    }

    return true;
  }

  // MIGRATION: now returns Paginated<FileVersion>. Per-page sort by descending
  // version; cross-page ordering follows KV key order (padded version ascending),
  // so the newest version sits on the last page when paging forward — this is
  // fine for "show me the last N versions" since most callers only page once.
  async getVersions(fid: string, cursor?: string): Promise<Paginated<FileVersion>> {
    const list = await this.kv.list({ prefix: `ver:${fid}:`, limit: DEFAULT_PAGE_SIZE, cursor });

    const values = await Promise.all(
      list.keys.map((k) => this.kv.get<FileVersion>(k.name, 'json')),
    );
    const versions = values.filter((v): v is FileVersion => v !== null);

    return {
      items: versions.sort((a, b) => b.version - a.version),
      cursor: list.list_complete ? null : list.cursor,
    };
  }

  // --- Comments ---

  async addComment(
    wid: string,
    fid: string,
    authorType: 'agent' | 'human',
    authorId: string,
    body: string,
    authorName?: string,
    lineStart?: number,
    lineEnd?: number,
  ): Promise<Comment> {
    const commentId = generateId('c');
    const now = new Date().toISOString();

    const comment: Comment = {
      id: commentId,
      file_id: fid,
      workspace_id: wid,
      author_type: authorType,
      author_id: authorId,
      author_name: authorName,
      body,
      created_at: now,
      line_start: lineStart,
      line_end: lineEnd,
    };

    await Promise.all([
      this.kv.put(`comment:${fid}:${commentId}`, JSON.stringify(comment)),
      this.kv.put(`idx:file_comments:${fid}:${invertTimestamp()}:${commentId}`, commentId),
    ]);

    return comment;
  }

  // MIGRATION: now returns Paginated<Comment>. Order is newest-first via
  // inverted-timestamp keys, which carries across pages.
  async getComments(fid: string, cursor?: string): Promise<Paginated<Comment>> {
    const list = await this.kv.list({ prefix: `idx:file_comments:${fid}:`, limit: DEFAULT_PAGE_SIZE, cursor });

    const cids = await Promise.all(list.keys.map((k) => this.kv.get(k.name)));
    const values = await Promise.all(
      cids
        .filter((c): c is string => Boolean(c))
        .map((c) => this.kv.get<Comment>(`comment:${fid}:${c}`, 'json')),
    );
    const comments = values.filter((c): c is Comment => c !== null);

    return { items: comments, cursor: list.list_complete ? null : list.cursor };
  }

  // --- Activity ---

  async recordActivity(
    wid: string,
    actorType: 'agent' | 'human',
    actorId: string,
    action: ActivityAction,
    targetType: ActivityTarget,
    targetId: string,
    targetPath?: string,
    metadata?: Record<string, string>,
    agentPlatform?: string,
  ): Promise<void> {
    const eventId = generateId('e');
    const now = new Date().toISOString();

    const event: ActivityEvent = {
      id: eventId,
      workspace_id: wid,
      actor_type: actorType,
      actor_id: actorId,
      agent_platform: agentPlatform,
      action,
      target_type: targetType,
      target_id: targetId,
      target_path: targetPath,
      metadata,
      created_at: now,
    };

    await this.kv.put(
      `activity:${wid}:${invertTimestamp()}:${eventId}`,
      JSON.stringify(event),
    );
  }

  // An org activates on its first resume of a session in a different harness;
  // metric keys count each principal once per ISO week. Reads skip the puts,
  // since most resumes repeat a key that already exists.
  // shortcut: two concurrent first resumes can both see no activation and the
  // later put wins; move to a Durable Object if the exact first one matters.
  async recordCrossHarnessResume(orgId: string, agentId: string, from: string, to: string, project: string): Promise<void> {
    const now = new Date();
    const at = now.toISOString();
    const activationKey = `activation:${orgId}`;
    const metricKey = `metric:xresume:${isoWeek(now)}:${orgId}:${agentId}`;
    const [activation, metric] = await Promise.all([this.kv.get(activationKey), this.kv.get(metricKey)]);
    await Promise.all([
      activation === null && this.kv.put(activationKey, JSON.stringify({ at, from, to, agent_id: agentId, project })),
      metric === null && this.kv.put(metricKey, '', { metadata: { from, to, at }, expirationTtl: XRESUME_TTL_SECONDS }),
    ]);
  }

  async hasResumeMarker(key: string): Promise<boolean> {
    return (await this.kv.get(key)) !== null;
  }

  async putResumeMarker(key: string): Promise<void> {
    await this.kv.put(key, '', { expirationTtl: RESUME_MARKER_TTL_SECONDS });
  }

  async resumeMarkers(orgId: string, month: string): Promise<string[]> {
    const names: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.kv.list({ prefix: `xresume_m:${orgId}:${month}:`, limit: 1000, cursor });
      for (const k of page.keys) names.push(k.name);
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return names;
  }

  // MIGRATION: signature changed from (wid, limit) to (wid, cursor). The
  // `?limit=` query param is no longer honored — clients page via `?cursor=`
  // instead. Order is newest-first via inverted-timestamp keys.
  async getActivity(wid: string, cursor?: string): Promise<Paginated<ActivityEvent>> {
    const list = await this.kv.list({ prefix: `activity:${wid}:`, limit: DEFAULT_PAGE_SIZE, cursor });
    const values = await Promise.all(
      list.keys.map((k) => this.kv.get<ActivityEvent>(k.name, 'json')),
    );
    const events = values.filter((e): e is ActivityEvent => e !== null);
    return { items: events, cursor: list.list_complete ? null : list.cursor };
  }

  // --- Organizations ---

  // A self-hosted instance has no plan limits, so only the bootstrap-token register route
  // (bootstrap = true) may create an org there; every sign-in path (email code, OAuth, CLI
  // login, MCP consent) refuses, and teammates get keys through /v1/keys. env is required
  // so no caller can skip this.
  async createOrg(orgId: string, name: string, createdBy: string, env: Pick<Env, 'SELF_HOSTED'>, bootstrap = false): Promise<OrgMeta> {
    if (selfHosted(env) && !bootstrap) throw new HTTPException(403, { res: Response.json(REGISTRATION_CLOSED, { status: 403 }) });
    const now = new Date();
    const org: OrgMeta = {
      id: orgId,
      name,
      plan: 'trial',
      created_at: now.toISOString(),
      created_by: createdBy,
      trial_ends_at: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    };
    await this.kv.put(`org:${orgId}`, JSON.stringify(org));
    return org;
  }

  async getOrg(orgId: string): Promise<OrgMeta | null> {
    return this.kv.get<OrgMeta>(`org:${orgId}`, 'json');
  }

  async updateOrg(orgId: string, updates: Partial<OrgMeta>): Promise<void> {
    const org = await this.getOrg(orgId);
    if (!org) return;
    await this.kv.put(`org:${orgId}`, JSON.stringify({ ...org, ...updates }));
  }

  async addOrgAgent(orgId: string, agentId: string, agentName?: string, agentEmail?: string): Promise<OrgAgent> {
    const agent: OrgAgent = {
      org_id: orgId,
      agent_id: agentId,
      agent_name: agentName,
      agent_email: agentEmail,
      joined_at: new Date().toISOString(),
    };
    await this.kv.put(`org_agent:${orgId}:${agentId}`, JSON.stringify(agent));
    return agent;
  }

  // MIGRATION: now returns Paginated<OrgAgent>. The /org endpoint flattens
  // items into `agents` for backward compatibility and exposes `agents_cursor`
  // alongside.
  async getOrgAgents(orgId: string, cursor?: string): Promise<Paginated<OrgAgent>> {
    const list = await this.kv.list({ prefix: `org_agent:${orgId}:`, limit: DEFAULT_PAGE_SIZE, cursor });
    const values = await Promise.all(
      list.keys.map((k) => this.kv.get<OrgAgent>(k.name, 'json')),
    );
    const agents = values.filter((a): a is OrgAgent => a !== null);
    return { items: agents, cursor: list.list_complete ? null : list.cursor };
  }

  async addOrgMember(orgId: string, email: string, role: OrgMember['role'], invitedBy: string): Promise<OrgMember> {
    const member: OrgMember = {
      org_id: orgId,
      email,
      role,
      joined_at: new Date().toISOString(),
      invited_by: invitedBy,
    };
    await this.kv.put(`org_member:${orgId}:${email}`, JSON.stringify(member));
    await this.kv.put(`idx:member_orgs:${email}:${orgId}`, orgId);
    return member;
  }

  async getOrgMember(orgId: string, email: string): Promise<OrgMember | null> {
    return this.kv.get<OrgMember>(`org_member:${orgId}:${email}`, 'json');
  }

  async removeOrgMember(orgId: string, email: string): Promise<boolean> {
    const existing = await this.getOrgMember(orgId, email);
    if (!existing) return false;
    // Keys go first: if this fails midway the membership is still there, so a
    // retried removal finds the member and finishes revoking.
    await this.revokeKeysCreatedBy(orgId, email.toLowerCase());
    await this.removeRolesInOrg(orgId, email.toLowerCase());
    await Promise.all([
      this.kv.delete(`org_member:${orgId}:${email}`),
      this.kv.delete(`idx:member_orgs:${email}:${orgId}`),
    ]);
    if ((await this.getOrgIdByEmail(email)) === orgId) {
      const fallback = await this.findOtherMemberOrg(email, orgId);
      if (fallback) await this.kv.put(`idx:email_org:${email}`, fallback);
      else await this.kv.delete(`idx:email_org:${email}`);
    }
    return true;
  }

  // KV list is eventually consistent, so the just-deleted index key can still
  // show up; every candidate is re-checked against its membership record.
  private async findOtherMemberOrg(email: string, excludeOrgId: string): Promise<string | null> {
    const prefix = `idx:member_orgs:${email}:`;
    let cursor: string | undefined;
    do {
      const list = await this.kv.list({ prefix, limit: DEFAULT_PAGE_SIZE, cursor });
      for (const key of list.keys) {
        const orgId = key.name.slice(prefix.length);
        if (orgId !== excludeOrgId && (await this.getOrgMember(orgId, email))) return orgId;
      }
      cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);
    return null;
  }

  // Accepting an invite is the only thing allowed to move an existing sign-in org.
  async setSignInOrg(email: string, orgId: string): Promise<void> {
    const previous = await this.getOrgIdByEmail(email);
    // Memberships created before idx:member_orgs existed are unindexed; index
    // the one being left so a later removal can fall back to it.
    if (previous && previous !== orgId && (await this.getOrgMember(previous, email))) {
      await this.kv.put(`idx:member_orgs:${email}:${previous}`, previous);
    }
    await this.kv.put(`idx:email_org:${email}`, orgId);
  }

  // --- Org invites ---
  //
  // `invite:<email>:<org_id>` lets the invitee list their own invites;
  // `idx:org_invites:<org_id>:<email>` holds the same record so the org can
  // list what it has sent. Both expire together.

  async createOrgInvite(invite: OrgInvite): Promise<void> {
    const value = JSON.stringify(invite);
    const opts = { expirationTtl: ORG_INVITE_TTL_SECONDS };
    await Promise.all([
      this.kv.put(`invite:${invite.email}:${invite.org_id}`, value, opts),
      this.kv.put(`idx:org_invites:${invite.org_id}:${invite.email}`, value, opts),
    ]);
  }

  async getOrgInvite(email: string, orgId: string): Promise<OrgInvite | null> {
    return this.kv.get<OrgInvite>(`invite:${email}:${orgId}`, 'json');
  }

  async deleteOrgInvite(email: string, orgId: string): Promise<void> {
    await Promise.all([
      this.kv.delete(`invite:${email}:${orgId}`),
      this.kv.delete(`idx:org_invites:${orgId}:${email}`),
    ]);
  }

  async listInvitesForEmail(email: string, cursor?: string): Promise<Paginated<OrgInvite>> {
    return this.listInvites(`invite:${email}:`, cursor);
  }

  async listInvitesForOrg(orgId: string, cursor?: string): Promise<Paginated<OrgInvite>> {
    return this.listInvites(`idx:org_invites:${orgId}:`, cursor);
  }

  private async listInvites(prefix: string, cursor?: string): Promise<Paginated<OrgInvite>> {
    const list = await this.kv.list({ prefix, limit: DEFAULT_PAGE_SIZE, cursor });
    const values = await Promise.all(list.keys.map((k) => this.kv.get<OrgInvite>(k.name, 'json')));
    return {
      items: values.filter((v): v is OrgInvite => v !== null),
      cursor: list.list_complete ? null : list.cursor,
    };
  }

  // MIGRATION: now returns Paginated<OrgMember>. The /org endpoint flattens
  // items into `members` for backward compatibility and exposes
  // `members_cursor` alongside.
  async getOrgMembers(orgId: string, cursor?: string): Promise<Paginated<OrgMember>> {
    const list = await this.kv.list({ prefix: `org_member:${orgId}:`, limit: DEFAULT_PAGE_SIZE, cursor });
    const values = await Promise.all(
      list.keys.map((k) => this.kv.get<OrgMember>(k.name, 'json')),
    );
    const members = values.filter((m): m is OrgMember => m !== null);
    return { items: members, cursor: list.list_complete ? null : list.cursor };
  }

  async getOrgIdByEmail(email: string): Promise<string | null> {
    return this.kv.get(`idx:email_org:${email}`);
  }

  async getOrCreateOrgForEmail(email: string, env: Pick<Env, 'SELF_HOSTED'>, name?: string): Promise<string> {
    const existing = await this.getOrgIdByEmail(email);
    if (existing) return existing;
    const orgId = generateId('org');
    await this.createOrg(orgId, `${name || email}'s org`, email, env);
    await this.addOrgMember(orgId, email, 'owner', email);
    await this.incrementUsage(orgId, 'member_count', 1);
    await this.kv.put(`idx:email_org:${email}`, orgId);
    return orgId;
  }

  // --- API keys (management) ---
  //
  // Auth still looks keys up by `api_key:<hash>` (auth.ts). The management
  // layer adds `idx:org_keys:<org_id>:<key_id>` -> keyHash so an org's keys
  // can be listed and revoked without ever reversing the hash. The hash, not
  // the secret, is the index value — the secret is shown once and never stored.

  async createApiKey(
    orgId: string,
    agentId: string,
    name: string,
    keyHash: string,
    prefix: string,
    createdBy?: string,
    mintedBy?: string,
    oauthClientId?: string,
  ): Promise<ApiKeyRecord> {
    const keyId = generateId('kid');
    const createdAt = new Date().toISOString();
    const meta: ApiKeyMeta = {
      agent_id: agentId,
      agent_name: name,
      org_id: orgId,
      created_at: createdAt,
      key_id: keyId,
      name,
      prefix,
      created_by: createdBy,
      ...(mintedBy && { minted_by: mintedBy }),
      ...(oauthClientId && { oauth_client_id: oauthClientId }),
    };
    await this.kv.put(`api_key:${keyHash}`, JSON.stringify(meta));
    await this.kv.put(`idx:org_keys:${orgId}:${keyId}`, keyHash);
    return { key_id: keyId, org_id: orgId, agent_id: agentId, name, prefix, created_at: createdAt };
  }

  async listApiKeys(orgId: string, cursor?: string): Promise<Paginated<ApiKeyRecord>> {
    const list = await this.kv.list({ prefix: `idx:org_keys:${orgId}:`, limit: DEFAULT_PAGE_SIZE, cursor });
    const hashes = await Promise.all(list.keys.map((k) => this.kv.get(k.name)));
    const metas = await Promise.all(
      hashes
        .filter((h): h is string => Boolean(h))
        .map(async (h) => {
          const [meta, usedAt] = await Promise.all([
            this.kv.get<ApiKeyMeta>(`api_key:${h}`, 'json'),
            this.kv.get(`api_key_used:${h}`),
          ]);
          if (meta && usedAt) meta.last_used_at = usedAt;
          return meta;
        }),
    );
    const records = metas
      .filter((m): m is ApiKeyMeta => m !== null && Boolean(m.key_id))
      .map((m) => ({
        key_id: m.key_id as string,
        org_id: m.org_id ?? orgId,
        agent_id: m.agent_id,
        name: m.name ?? m.agent_name ?? 'key',
        prefix: m.prefix ?? '',
        created_at: m.created_at,
        last_used_at: m.last_used_at,
      }));
    return { items: records, cursor: list.list_complete ? null : list.cursor };
  }

  async getApiKey(orgId: string, keyId: string): Promise<ApiKeyMeta | null> {
    const keyHash = await this.kv.get(`idx:org_keys:${orgId}:${keyId}`);
    return keyHash ? this.kv.get<ApiKeyMeta>(`api_key:${keyHash}`, 'json') : null;
  }

  async revokeApiKey(orgId: string, keyId: string): Promise<boolean> {
    const idxKey = `idx:org_keys:${orgId}:${keyId}`;
    const keyHash = await this.kv.get(idxKey);
    if (!keyHash) return false;
    await this.deleteApiKey(orgId, keyHash, idxKey, await this.kv.get<ApiKeyMeta>(`api_key:${keyHash}`, 'json'));
    return true;
  }

  // The org_agent record is marked rather than deleted: a legacy workspace's org is
  // still found through its creator's record. The mark lands before the key goes, so
  // a retry after a failure in between still finds the key and finishes.
  private async deleteApiKey(orgId: string, keyHash: string, idxKey: string, meta: ApiKeyMeta | null): Promise<void> {
    if (meta) {
      const agentKey = `org_agent:${orgId}:${meta.agent_id}`;
      const agent = await this.kv.get<OrgAgent>(agentKey, 'json');
      if (agent && !agent.revoked_at) {
        await this.kv.put(agentKey, JSON.stringify({ ...agent, revoked_at: new Date().toISOString() }));
        await this.incrementUsage(orgId, 'agent_count', -1);
      }
    }
    await Promise.all([
      this.kv.delete(`api_key:${keyHash}`),
      this.kv.delete(`api_key_used:${keyHash}`),
      this.kv.delete(idxKey),
    ]);
  }

  // The keys hosted-MCP consent minted for this member, so the consent can sweep the
  // ones no live grant holds.
  async oauthKeysCreatedBy(orgId: string, email: string): Promise<ApiKeyMeta[]> {
    const keys: ApiKeyMeta[] = [];
    let cursor: string | undefined;
    do {
      const list = await this.kv.list({ prefix: `idx:org_keys:${orgId}:`, limit: DEFAULT_PAGE_SIZE, cursor });
      const hashes = await Promise.all(list.keys.map((k) => this.kv.get(k.name)));
      const metas = await Promise.all(hashes.map((h) => (h ? this.kv.get<ApiKeyMeta>(`api_key:${h}`, 'json') : null)));
      for (const meta of metas) if (meta?.oauth_client_id && meta.key_id && meta.created_by === email) keys.push(meta);
      cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);
    return keys;
  }

  private async revokeKeysCreatedBy(orgId: string, email: string): Promise<void> {
    const prefix = `idx:org_keys:${orgId}:`;
    let cursor: string | undefined;
    do {
      const list = await this.kv.list({ prefix, limit: DEFAULT_PAGE_SIZE, cursor });
      // Sequential: each revoke decrements agent_count read-modify-write, and
      // parallel ones overwrite each other's decrement.
      for (const { name: idxKey } of list.keys) {
        const keyHash = await this.kv.get(idxKey);
        if (!keyHash) continue;
        const meta = await this.kv.get<ApiKeyMeta>(`api_key:${keyHash}`, 'json');
        if (meta?.created_by === email) await this.deleteApiKey(orgId, keyHash, idxKey, meta);
      }
      cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);
  }

  // A role grant outlives org membership, so removal takes the member's roles too.
  private async removeRolesInOrg(orgId: string, email: string): Promise<void> {
    email = email.toLowerCase();
    const prefix = `idx:org_workspaces:${orgId}:`;
    let cursor: string | undefined;
    do {
      const list = await this.kv.list({ prefix, limit: DEFAULT_PAGE_SIZE, cursor });
      await Promise.all(list.keys.map(({ name }) => this.kv.delete(`role:${name.slice(prefix.length)}:${email}`)));
      cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);
  }

  // --- Share tokens ---
  //
  // `token:<tid>` is written at creation and again only to revoke; uses are counted
  // at `token_used:<tid>`. `idx:ws_tokens:<ws_id>:<tid>` lists a workspace's links;
  // links made before it existed are not listed but can still be revoked by id.

  async saveShareToken(meta: ShareTokenMeta): Promise<void> {
    await this.kv.put(`token:${meta.token_id}`, JSON.stringify(meta));
    await this.kv.put(`idx:ws_tokens:${meta.workspace_id}:${meta.token_id}`, meta.token_id);
  }

  async listShareTokens(wid: string, cursor?: string): Promise<Paginated<ShareTokenMeta>> {
    const prefix = `idx:ws_tokens:${wid}:`;
    const list = await this.kv.list({ prefix, limit: DEFAULT_PAGE_SIZE, cursor });
    const metas = await Promise.all(list.keys.map(async ({ name }) => {
      const tid = name.slice(prefix.length);
      const [meta, used] = await Promise.all([
        this.kv.get<ShareTokenMeta>(`token:${tid}`, 'json'),
        this.kv.get(`token_used:${tid}`),
      ]);
      return meta && (used === null ? meta : { ...meta, use_count: Number(used) });
    }));
    return {
      items: metas.filter((m): m is ShareTokenMeta => m !== null),
      cursor: list.list_complete ? null : list.cursor,
    };
  }

  async revokeShareToken(wid: string, tid: string): Promise<boolean> {
    const meta = await this.kv.get<ShareTokenMeta>(`token:${tid}`, 'json');
    if (!meta || meta.workspace_id !== wid) return false;
    if (!meta.revoked) await this.kv.put(`token:${tid}`, JSON.stringify({ ...meta, revoked: true }));
    if (meta.email) {
      const role = await this.getRole(wid, meta.email);
      if (role?.granted_via === tid) await this.removeRole(wid, meta.email);
    }
    return true;
  }

  // --- Sessions ---

  async createSession(sessionId: string, email: string, orgId?: string): Promise<SessionMeta> {
    const now = new Date();
    const session: SessionMeta = {
      session_id: sessionId,
      email,
      org_id: orgId,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
      last_active_at: now.toISOString(),
    };
    await this.kv.put(`session:${sessionId}`, JSON.stringify(session), {
      expirationTtl: 30 * 24 * 60 * 60, // auto-expire in KV
    });
    return session;
  }

  async getSession(sessionId: string): Promise<SessionMeta | null> {
    const session = await this.kv.get<SessionMeta>(`session:${sessionId}`, 'json');
    if (!session) return null;
    if (new Date(session.expires_at) < new Date()) {
      await this.kv.delete(`session:${sessionId}`);
      return null;
    }
    return session;
  }

  async touchSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;
    session.last_active_at = new Date().toISOString();
    await this.kv.put(`session:${sessionId}`, JSON.stringify(session), {
      expirationTtl: 30 * 24 * 60 * 60,
    });
  }

  async setSessionOrg(sessionId: string, orgId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;
    await this.kv.put(`session:${sessionId}`, JSON.stringify({ ...session, org_id: orgId }), {
      expirationTtl: 30 * 24 * 60 * 60,
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.kv.delete(`session:${sessionId}`);
  }

  // --- Role Delegation ---

  async assignRole(wid: string, email: string, permission: import('@agentdrive/shared').Permission, assignedBy: string, grantedVia?: string): Promise<RoleAssignment> {
    email = email.toLowerCase();
    const role: RoleAssignment = {
      workspace_id: wid,
      email,
      permission,
      assigned_by: assignedBy,
      assigned_at: new Date().toISOString(),
      ...(grantedVia && { granted_via: grantedVia }),
    };
    await this.kv.put(`role:${wid}:${email}`, JSON.stringify(role));
    return role;
  }

  async getRole(wid: string, email: string): Promise<RoleAssignment | null> {
    email = email.toLowerCase();
    return this.kv.get<RoleAssignment>(`role:${wid}:${email}`, 'json');
  }

  // MIGRATION: now returns Paginated<RoleAssignment>.
  async getRoles(wid: string, cursor?: string): Promise<Paginated<RoleAssignment>> {
    const list = await this.kv.list({ prefix: `role:${wid}:`, limit: DEFAULT_PAGE_SIZE, cursor });
    const values = await Promise.all(
      list.keys.map((k) => this.kv.get<RoleAssignment>(k.name, 'json')),
    );
    const roles = values.filter((r): r is RoleAssignment => r !== null);
    return { items: roles, cursor: list.list_complete ? null : list.cursor };
  }

  async removeRole(wid: string, email: string): Promise<boolean> {
    email = email.toLowerCase();
    const existing = await this.getRole(wid, email);
    if (!existing) return false;
    await this.kv.delete(`role:${wid}:${email}`);
    return true;
  }

  // --- Usage Tracking ---

  async getUsage(orgId: string): Promise<Usage> {
    const usage = await this.kv.get<Partial<Usage>>(`usage:${orgId}`, 'json');
    return { ...EMPTY_USAGE, ...usage };
  }

  // shortcut: read-modify-write on one KV key, so concurrent writers can lose an
  // increment and the counters are approximate; move to a Durable Object if billing
  // ever needs exact counts. Clamped at zero: content written before metering
  // started is subtracted on delete without ever having been added.
  async incrementUsage(orgId: string, field: keyof Usage, delta: number): Promise<void> {
    if (delta === 0) return;
    const usage = await this.getUsage(orgId);
    usage[field] = Math.max(0, usage[field] + delta);
    await this.kv.put(`usage:${orgId}`, JSON.stringify(usage));
  }

  private async workspaceOrg(wid: string): Promise<string | undefined> {
    return (await this.kv.get<WorkspaceMeta>(`ws:${wid}`, 'json'))?.org_id;
  }

  // --- OAuth Provider Linking ---

  async getUserByProvider(provider: OAuthProvider, sub: string): Promise<ProviderLinkedUser | null> {
    return this.kv.get<ProviderLinkedUser>(`idx:user_${provider}:${sub}`, 'json');
  }

  async linkProvider(orgId: string, provider: OAuthProvider, sub: string, email: string): Promise<ProviderLinkedUser> {
    const record: ProviderLinkedUser = {
      org_id: orgId,
      email,
      provider,
      provider_sub: sub,
      linked_at: new Date().toISOString(),
    };
    await this.kv.put(`idx:user_${provider}:${sub}`, JSON.stringify(record));
    return record;
  }
}
