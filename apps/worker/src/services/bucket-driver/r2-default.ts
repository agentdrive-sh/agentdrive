import type { BucketDriver, BucketObject } from './types.js';

// Default driver — wraps the env.R2 binding to the agentdrive-content bucket.
// All v1 reads + writes route through here. Phase 4 BYO-bucket adds two
// sibling drivers (cf-r2-cross-account, s3-hmac) implementing the same
// interface; storage.ts and keyword-search.ts call them through this
// surface without knowing which driver is which.

export class R2DefaultDriver implements BucketDriver {
  readonly provider = 'agentdrive-r2' as const;
  readonly bucketConfigId = 'default';

  constructor(private bucket: R2Bucket) {}

  async head(key: string): Promise<{ size: number } | null> {
    const obj = await this.bucket.head(key);
    if (!obj) return null;
    return { size: obj.size };
  }

  async get(key: string): Promise<BucketObject | null> {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    return {
      text: () => obj.text(),
      arrayBuffer: () => obj.arrayBuffer(),
      size: obj.size,
    };
  }

  async put(
    key: string,
    body: string | ArrayBuffer | ReadableStream,
    opts: { contentType?: string } = {},
  ): Promise<void> {
    await this.bucket.put(key, body as string | ArrayBuffer | ReadableStream<Uint8Array>, {
      httpMetadata: opts.contentType ? { contentType: opts.contentType } : undefined,
    });
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}
