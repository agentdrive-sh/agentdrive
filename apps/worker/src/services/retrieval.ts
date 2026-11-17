import type { Env } from '../env.js';
import type { EmbeddingHit } from './embeddings.js';
import { StorageService } from './storage.js';

// Vectorize is an asynchronous index, never the authority for file existence,
// tenant ownership or current content. Revalidate before deduping/ranking so an
// old high-scoring vector cannot hide the current version or leak deleted text.
export async function currentEmbeddingHits(
  env: Env,
  hits: EmbeddingHit[],
  orgId: string,
  workspaceId?: string,
): Promise<EmbeddingHit[]> {
  const storage = new StorageService(env.KV, env.R2);
  const workspaces = new Map<string, ReturnType<StorageService['getWorkspace']>>();
  const files = new Map<string, ReturnType<StorageService['getFileByPath']>>();
  const checked = await Promise.all(hits.map(async (hit): Promise<EmbeddingHit | null> => {
    const meta = hit.metadata;
    if (!meta || meta.org_id !== orgId || !meta.ws_id || !meta.path || !meta.content_hash) return null;
    if (workspaceId && meta.ws_id !== workspaceId) return null;
    if (!workspaces.has(meta.ws_id)) workspaces.set(meta.ws_id, storage.getWorkspace(meta.ws_id));
    const workspace = await workspaces.get(meta.ws_id);
    if (!workspace || workspace.org_id !== orgId) return null;
    const key = JSON.stringify([meta.ws_id, meta.path]);
    if (!files.has(key)) files.set(key, storage.getFileByPath(meta.ws_id, meta.path));
    const file = await files.get(key);
    if (!file || file.content_hash !== meta.content_hash) return null;
    return { ...hit, metadata: { ...meta, created_at: Date.parse(file.updated_at) } };
  }));
  return checked.filter((hit): hit is EmbeddingHit => hit !== null);
}
