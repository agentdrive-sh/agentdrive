import { AwsClient } from 'aws4fetch';
import type { BucketDriver, BucketObject } from './types.js';
import type { StorageProvider } from '@agentdrive/shared';

// Shared S3-compatible driver. Used by:
//   - cf-r2-cross-account (CF R2 via its S3 endpoint with the account's
//     R2 access key + secret)
//   - s3-hmac (any AWS-S3 / Backblaze / Wasabi / MinIO endpoint with
//     SigV4 credentials)
//
// Authentication is AWS Signature V4 via aws4fetch. The driver records
// its provider tag so call sites can branch on it (e.g. for fail-closed
// health flagging or per-provider metrics) without re-deriving from the
// credentials.
//
// Per E3: surfaces transport / auth errors as thrown errors. Returns null
// from head/get for genuine 404s only.

export interface S3DriverConfig {
  provider: 'cf-r2-cross-account' | 's3-hmac';
  bucketConfigId: string;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class S3CompatDriver implements BucketDriver {
  readonly provider: StorageProvider;
  readonly bucketConfigId: string;
  private readonly client: AwsClient;
  private readonly base: string;

  constructor(private cfg: S3DriverConfig) {
    this.provider = cfg.provider;
    this.bucketConfigId = cfg.bucketConfigId;
    this.client = new AwsClient({
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      region: cfg.region,
      service: 's3',
      // No automatic retries — drivers are fail-closed per E3. The caller
      // (route handler) decides whether to retry, and the upcoming
      // bucket_config.health flag is what flips a customer bucket to
      // degraded on persistent error.
      retries: 0,
    });
    // Virtual-hosted style URL: https://<endpoint>/<bucket>/<key>. R2 S3
    // and AWS-managed buckets both accept path-style with the right
    // endpoint. Trim trailing slash so concat is predictable.
    this.base = `${cfg.endpoint.replace(/\/$/, '')}/${encodeURIComponent(cfg.bucket)}`;
  }

  private url(key: string): string {
    // Each path segment gets encoded so `content/abc` -> `content/abc`
    // (slashes preserved) but unusual chars are escaped.
    const segments = key.split('/').map(encodeURIComponent);
    return `${this.base}/${segments.join('/')}`;
  }

  async head(key: string): Promise<{ size: number } | null> {
    const res = await this.client.fetch(this.url(key), { method: 'HEAD' });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`S3 HEAD ${this.provider}: ${res.status} ${res.statusText}`);
    }
    const lenHeader = res.headers.get('content-length');
    const size = lenHeader ? Number.parseInt(lenHeader, 10) : 0;
    return { size: Number.isFinite(size) ? size : 0 };
  }

  async get(key: string): Promise<BucketObject | null> {
    const res = await this.client.fetch(this.url(key));
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`S3 GET ${this.provider}: ${res.status} ${res.statusText}`);
    }
    const buf = await res.arrayBuffer();
    return {
      size: buf.byteLength,
      arrayBuffer: async () => buf,
      text: async () => new TextDecoder().decode(buf),
    };
  }

  async put(
    key: string,
    body: string | ArrayBuffer | ReadableStream,
    opts: { contentType?: string } = {},
  ): Promise<void> {
    const headers: Record<string, string> = {};
    if (opts.contentType) headers['content-type'] = opts.contentType;
    // aws4fetch needs a known body length / content for SigV4. String +
    // ArrayBuffer both work; ReadableStream requires the caller to pass
    // a `content-length` header which most S3-compatible endpoints
    // require anyway.
    const res = await this.client.fetch(this.url(key), {
      method: 'PUT',
      headers,
      body: body as BodyInit,
    });
    if (!res.ok) {
      throw new Error(`S3 PUT ${this.provider}: ${res.status} ${res.statusText}`);
    }
  }

  async delete(key: string): Promise<void> {
    const res = await this.client.fetch(this.url(key), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      throw new Error(`S3 DELETE ${this.provider}: ${res.status} ${res.statusText}`);
    }
  }
}
