import type {
  BucketConfigMeta,
  BucketConfigPublic,
  BucketHealth,
  Paginated,
  StorageProvider,
} from '@agentdrive/shared';
import { generateId, maskBucketConfig } from '@agentdrive/shared';

// KV-backed bucket_config storage. v1 layout:
//
//   bucket_config:<org_id>:<config_id>  →  BucketConfigMeta JSON
//
// One reserved id is 'default' — every org has an implicit default config
// that maps to the AgentDrive R2 bucket. We don't materialize it in KV;
// readers check the locator first and return the implicit default when
// no key exists.
//
// Sensitive material (secret_access_key) is stored alongside the public
// fields. GET endpoints route through maskBucketConfig() so the secret
// never crosses the wire after the initial POST.
//
// Future Phase 4 step: encrypt secret_access_key at rest with KEK. For
// v1 we accept KV-level storage of the secret since KV is private to
// the worker and the trust boundary lives at the worker auth layer.

const PAGE_SIZE = 50;
type StoredConfig = BucketConfigMeta & { archived_at?: string };

export interface CreateBucketConfigInput {
  org_id: string;
  name: string;
  provider: StorageProvider;
  endpoint?: string;
  region?: string;
  bucket?: string;
  access_key_id?: string;
  secret_access_key?: string;
  created_by: string;
}

export class BucketConfigStore {
  constructor(private kv: KVNamespace) {}

  private key(orgId: string, configId: string): string {
    return `bucket_config:${orgId}:${configId}`;
  }

  async create(input: CreateBucketConfigInput): Promise<BucketConfigMeta> {
    const id = generateId('bcfg');
    const meta: BucketConfigMeta = {
      id,
      org_id: input.org_id,
      name: input.name,
      provider: input.provider,
      endpoint: input.endpoint,
      region: input.region,
      bucket: input.bucket,
      access_key_id: input.access_key_id,
      secret_access_key: input.secret_access_key,
      health: 'unverified',
      created_at: new Date().toISOString(),
      created_by: input.created_by,
    };
    await this.kv.put(this.key(input.org_id, id), JSON.stringify(meta));
    return meta;
  }

  async get(orgId: string, configId: string): Promise<BucketConfigMeta | null> {
    const meta = await this.kv.get<StoredConfig>(this.key(orgId, configId), 'json');
    return meta?.archived_at ? null : meta;
  }

  async list(orgId: string, cursor?: string): Promise<Paginated<BucketConfigPublic>> {
    const list = await this.kv.list({
      prefix: `bucket_config:${orgId}:`,
      limit: PAGE_SIZE,
      cursor,
    });
    const metas = await Promise.all(
      list.keys.map((k) => this.kv.get<StoredConfig>(k.name, 'json')),
    );
    const items = metas
      .filter((m): m is StoredConfig => m !== null && !m.archived_at)
      .map((m) => maskBucketConfig(m));
    return { items, cursor: list.list_complete ? null : list.cursor };
  }

  async delete(orgId: string, configId: string): Promise<boolean> {
    const existing = await this.get(orgId, configId);
    if (!existing) return false;
    // Retirement removes it from active management/new writes while keeping
    // credentials available to immutable historical file/version locators.
    // Physical deletion would strand old bytes, even after switching buckets.
    await this.kv.put(this.key(orgId, configId), JSON.stringify({ ...existing, archived_at: new Date().toISOString() }));
    return true;
  }

  async markHealth(
    orgId: string,
    configId: string,
    health: BucketHealth,
    lastError?: string,
  ): Promise<BucketConfigMeta | null> {
    const meta = await this.get(orgId, configId);
    if (!meta) return null;
    const updated: BucketConfigMeta = {
      ...meta,
      health,
      last_verified_at: health === 'healthy' ? new Date().toISOString() : meta.last_verified_at,
      last_error: lastError,
    };
    await this.kv.put(this.key(orgId, configId), JSON.stringify(updated));
    return updated;
  }
}
