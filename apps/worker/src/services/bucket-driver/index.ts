import { defaultObjectKey, resolveLocator } from '@agentdrive/shared';
import type { StorageLocator } from '@agentdrive/shared';
import type { Env } from '../../env.js';
import { R2DefaultDriver } from './r2-default.js';
import { S3CompatDriver, type S3DriverConfig } from './s3-compat.js';
import type { BucketDriver, ResolvedBucketTarget } from './types.js';

// Factory for BucketDrivers. v1 knows three providers:
//
//   - agentdrive-r2       — wraps env.R2 directly. Default for every org.
//   - cf-r2-cross-account — Cloudflare R2 S3-compatible endpoint with the
//                           customer's R2 account access key + secret.
//   - s3-hmac             — any AWS-S3 / Backblaze / Wasabi / MinIO
//                           endpoint with SigV4 credentials.
//
// Reads ALWAYS go through resolveBucketTarget — never raw env.R2 calls.
// That's the contract that keeps T-E1 honest: a file written under one
// bucket_config keeps reading from the bucket it was written to, even
// after the org switches its default.
//
// The next Phase 4 step adds a KV-backed bucket_config lookup; today the
// non-default callers pass credentials in directly via
// getDriverFromConfig().

export interface DriverContext {
  // Set by callers that have resolved a customer bucket_config from KV.
  // When unset, the factory returns the agentdrive-r2 default.
  s3?: S3DriverConfig;
}

export function getBucketDriver(
  env: Env,
  locator: StorageLocator | undefined,
  ctx: DriverContext = {},
): BucketDriver {
  const provider = locator?.provider ?? 'agentdrive-r2';
  switch (provider) {
    case 'agentdrive-r2':
      return new R2DefaultDriver(env.R2);
    case 'cf-r2-cross-account':
    case 's3-hmac':
      if (!ctx.s3) {
        throw new Error(
          `BucketDriver for provider '${provider}' requires an s3 config — caller must resolve bucket_config_id=${locator?.bucket_config_id ?? 'unknown'} from KV first.`,
        );
      }
      if (ctx.s3.provider !== provider) {
        throw new Error(
          `BucketDriver provider mismatch: locator says '${provider}' but s3 config says '${ctx.s3.provider}'`,
        );
      }
      return new S3CompatDriver(ctx.s3);
    default:
      throw new Error(`Unknown storage provider: ${String(provider)}`);
  }
}

export function getDriverFromConfig(env: Env, config: S3DriverConfig | undefined): BucketDriver {
  if (!config) return new R2DefaultDriver(env.R2);
  return new S3CompatDriver(config);
}

// Convenience for the common case: callers have a (FileMeta | FileVersion)
// and a contentHash. This returns the driver AND the object_key to use
// against it. Future call sites should prefer this over getBucketDriver
// + manual key construction.
export function resolveBucketTarget(
  env: Env,
  meta: StorageLocator,
  contentHash: string,
): ResolvedBucketTarget {
  const resolved = resolveLocator(meta, contentHash);
  const driver = getBucketDriver(env, resolved);
  return { driver, objectKey: resolved.object_key };
}

// For write-time use, when the caller doesn't have an existing locator yet
// (new file write). Returns the v1 default driver + canonical content key.
export function resolveDefaultWriteTarget(env: Env, contentHash: string): ResolvedBucketTarget {
  return {
    driver: new R2DefaultDriver(env.R2),
    objectKey: defaultObjectKey(contentHash),
  };
}

export { R2DefaultDriver, S3CompatDriver };
export type { S3DriverConfig } from './s3-compat.js';
export type { BucketDriver, ResolvedBucketTarget } from './types.js';
