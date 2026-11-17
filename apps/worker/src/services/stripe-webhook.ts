// Stripe webhook signature verification using Web Crypto — no Stripe SDK, to
// match the raw-fetch Stripe calls in routes/billing.ts and keep the Worker
// bundle small. Implements Stripe's v1 scheme: HMAC-SHA256 over
// `${timestamp}.${rawBody}` keyed by the endpoint signing secret, compared
// constant-time against the header's v1 signatures, with a replay-tolerance
// window on the timestamp.

export interface StripeEvent {
  id?: string;
  type: string;
  data: { object: Record<string, unknown> };
}

const DEFAULT_TOLERANCE_SEC = 300;

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

// Constant-time compare on equal-length strings to avoid leaking match
// progress via timing — same posture as the share-token HMAC verify.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

interface ParsedSignatureHeader {
  timestamp: number;
  v1: string[];
}

function parseSignatureHeader(header: string): ParsedSignatureHeader | null {
  let timestamp: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 't') timestamp = Number.parseInt(value, 10);
    else if (key === 'v1') v1.push(value);
  }
  if (timestamp === null || Number.isNaN(timestamp) || v1.length === 0) return null;
  return { timestamp, v1 };
}

// Returns the parsed event when the signature is valid and within tolerance;
// returns null on a missing/malformed header, signature mismatch, replayed
// timestamp, or unparseable body. Callers MUST treat null as a 400.
export async function constructStripeEvent(
  rawBody: string,
  sigHeader: string | undefined,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  toleranceSec: number = DEFAULT_TOLERANCE_SEC,
): Promise<StripeEvent | null> {
  if (!sigHeader) return null;

  const parsed = parseSignatureHeader(sigHeader);
  if (!parsed) return null;

  if (Math.abs(nowSec - parsed.timestamp) > toleranceSec) return null;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${parsed.timestamp}.${rawBody}`));
  const expected = toHex(mac);

  if (!parsed.v1.some((sig) => timingSafeEqual(sig, expected))) return null;

  try {
    return JSON.parse(rawBody) as StripeEvent;
  } catch {
    return null;
  }
}
