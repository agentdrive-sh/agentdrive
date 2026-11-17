const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const ID_LENGTH = 12;

export function generateId(prefix?: string): string {
  const bytes = new Uint8Array(ID_LENGTH);
  crypto.getRandomValues(bytes);
  let id = '';
  for (let i = 0; i < ID_LENGTH; i++) {
    id += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return prefix ? `${prefix}_${id}` : id;
}

export function invertTimestamp(ts?: number): string {
  const t = ts ?? Date.now();
  return String(Number.MAX_SAFE_INTEGER - t).padStart(16, '0');
}

export function padVersion(version: number): string {
  return String(version).padStart(6, '0');
}
