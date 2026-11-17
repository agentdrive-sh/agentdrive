const PATH_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._\-/]*$/;
const MAX_PATH_LENGTH = 500;
const MAX_FILE_SIZE = 1024 * 1024; // 1MB

export function validatePath(path: string): string | null {
  if (!path || path.length > MAX_PATH_LENGTH) {
    return 'Path must be 1-500 characters';
  }
  if (!PATH_REGEX.test(path)) {
    return 'Path must start with alphanumeric and contain only alphanumeric, dots, hyphens, underscores, and slashes';
  }
  if (path.includes('..')) {
    return 'Path traversal not allowed';
  }
  if (path.includes('//')) {
    return 'Double slashes not allowed';
  }
  return null;
}

export function validateFileSize(size: number): string | null {
  if (size > MAX_FILE_SIZE) {
    return `File exceeds maximum size of ${MAX_FILE_SIZE} bytes`;
  }
  return null;
}

export function normalizeApiKey(key: string): string {
  return key.trim();
}

export async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(normalizeApiKey(key));
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hash));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hash));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
