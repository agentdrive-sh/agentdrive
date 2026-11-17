import type { StorageLocator, StorageProvider } from '@agentdrive/shared';

// Phase 4 BucketDriver — the seam between storage code and the underlying
// object store. v1 ships only the default driver (wraps env.R2). Future
// drivers (cf-r2-cross-account, s3-hmac) implement the same interface so
// the rest of the codebase doesn't change when BYO-bucket lands.
//
// Per E3: when a customer's bucket becomes unreachable, drivers SHOULD
// throw — never silently fall back. The fail-closed health flag (Phase 4
// proper) lives one layer up; the driver's job is to surface the error
// cleanly.

export interface BucketObject {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  size: number;
}

export interface BucketDriver {
  readonly provider: StorageProvider;
  readonly bucketConfigId: string;

  // Returns null when the object is absent; throws on transport / auth errors.
  head(key: string): Promise<{ size: number } | null>;
  get(key: string): Promise<BucketObject | null>;
  put(
    key: string,
    body: string | ArrayBuffer | ReadableStream,
    opts?: { contentType?: string },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface ResolvedBucketTarget {
  driver: BucketDriver;
  objectKey: string;
}

// What a caller hands the factory. For v1 only `provider: 'agentdrive-r2'`
// is recognized. Phase 4 proper extends with bucket_config records pulled
// from KV.
export interface BucketResolution {
  locator: StorageLocator;
  contentHash: string;
}
