import { defaultObjectKey, resolveLocator } from '@agentdrive/shared';
import type {
  BucketConfigMeta,
  FileMeta,
  StorageLocator,
  WorkspaceMeta,
} from '@agentdrive/shared';
import type { Env } from '../../env.js';
import { R2DefaultDriver } from './r2-default.js';
import { S3CompatDriver, type S3DriverConfig } from './s3-compat.js';
import type { BucketDriver } from './types.js';

// Driver resolution for storage operations. Two angles:
//
//   resolveDriverForRead(env, fileMeta)
//     - uses the locator recorded on the file (the bucket the file was
//       written to) so a workspace can switch its bucket_config without
//       breaking reads of files written before the switch.
//
//   resolveDriverForWrite(env, workspace)
//     - uses the workspace's CURRENT bucket_config_id so new writes land
//       in the configured bucket. Returns the locator stamp to record on
//       the new FileMeta + FileVersion.
//
// Both lookups are KV reads scoped by org_id; cross-org access throws.

interface ResolvedWrite {
  driver: BucketDriver;
  locator: Required<StorageLocator>;
}

interface ResolvedRead {
  driver: BucketDriver;
  objectKey: string;
}

async function loadConfig(
  env: Env,
  orgId: string,
  configId: string,
): Promise<BucketConfigMeta | null> {
  return env.KV.get<BucketConfigMeta>(`bucket_config:${orgId}:${configId}`, 'json');
}

function s3ConfigFrom(meta: BucketConfigMeta): S3DriverConfig {
  if (meta.provider === 'agentdrive-r2') {
    throw new Error(`bucket_config ${meta.id} is provider=agentdrive-r2; no S3 config to build`);
  }
  if (!meta.endpoint || !meta.region || !meta.bucket || !meta.access_key_id || !meta.secret_access_key) {
    throw new Error(`bucket_config ${meta.id} is missing required s3-compat fields`);
  }
  return {
    provider: meta.provider,
    bucketConfigId: meta.id,
    endpoint: meta.endpoint,
    region: meta.region,
    bucket: meta.bucket,
    accessKeyId: meta.access_key_id,
    secretAccessKey: meta.secret_access_key,
  };
}

export async function resolveDriverForWrite(
  env: Env,
  workspace: WorkspaceMeta,
  contentHash: string,
): Promise<ResolvedWrite> {
  const configId = workspace.bucket_config_id;
  if (!configId || configId === 'default') {
    return {
      driver: new R2DefaultDriver(env.R2),
      locator: {
        bucket_config_id: 'default',
        provider: 'agentdrive-r2',
        object_key: defaultObjectKey(contentHash),
        key_version: 1,
      },
    };
  }
  if (!workspace.org_id) {
    throw new Error(`workspace ${workspace.id} has bucket_config_id set but no org_id`);
  }
  const meta = await loadConfig(env, workspace.org_id, configId);
  if (!meta) {
    throw new Error(`bucket_config ${configId} not found for workspace ${workspace.id}`);
  }
  if ((meta as BucketConfigMeta & { archived_at?: string }).archived_at) {
    throw new Error(`bucket_config ${configId} is retired; refusing new writes`);
  }
  if (meta.health === 'degraded') {
    throw new Error(
      `bucket_config ${configId} is marked degraded (last_error: ${meta.last_error ?? 'unknown'}); refusing to write`,
    );
  }
  if (meta.provider === 'agentdrive-r2') {
    return {
      driver: new R2DefaultDriver(env.R2),
      locator: {
        bucket_config_id: configId,
        provider: 'agentdrive-r2',
        object_key: defaultObjectKey(contentHash),
        key_version: 1,
      },
    };
  }
  const s3 = s3ConfigFrom(meta);
  return {
    driver: new S3CompatDriver(s3),
    locator: {
      bucket_config_id: configId,
      provider: meta.provider,
      object_key: defaultObjectKey(contentHash),
      key_version: 1,
    },
  };
}

export async function resolveDriverForRead(env: Env, file: FileMeta): Promise<ResolvedRead> {
  const resolved = resolveLocator(file, file.content_hash);
  if (resolved.provider === 'agentdrive-r2') {
    return { driver: new R2DefaultDriver(env.R2), objectKey: resolved.object_key };
  }
  // Need org_id to find the bucket_config. WorkspaceMeta -> org_id mapping
  // is the simplest path; in practice route handlers already have it from
  // auth context, but we resolve from KV here to keep the helper standalone.
  const wsRaw = await env.KV.get<WorkspaceMeta>(`ws:${file.workspace_id}`, 'json');
  if (!wsRaw?.org_id) {
    throw new Error(`cannot resolve org_id for workspace ${file.workspace_id} (file ${file.id})`);
  }
  const cfg = await loadConfig(env, wsRaw.org_id, resolved.bucket_config_id);
  if (!cfg) {
    throw new Error(
      `bucket_config ${resolved.bucket_config_id} not found for file ${file.id} — recorded at write time, missing now`,
    );
  }
  if (cfg.provider === 'agentdrive-r2') {
    return { driver: new R2DefaultDriver(env.R2), objectKey: resolved.object_key };
  }
  const s3 = s3ConfigFrom(cfg);
  return { driver: new S3CompatDriver(s3), objectKey: resolved.object_key };
}
