import { useToken } from '../contexts/TokenContext';

const API_BASE = import.meta.env.VITE_API_URL || '';

export function useApiClient() {
  const { token, sessionId } = useToken();

  async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Session auth takes precedence, then share token
    if (sessionId) {
      headers['X-Session-Token'] = sessionId;
    } else if (token) {
      headers['X-Share-Token'] = token;
    }

    const res = await fetch(`${API_BASE}/v1${path}`, {
      ...options,
      headers: { ...headers, ...options?.headers },
    });

    const json = await res.json() as { success: boolean; data?: T; error?: string };

    if (!res.ok || !json.success) {
      throw new Error(json.error || `Request failed: ${res.status}`);
    }

    return json.data as T;
  }

  // Public API call (no auth headers)
  async function publicFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const res = await fetch(`${API_BASE}/v1${path}`, {
      ...options,
      headers: { ...headers, ...options?.headers },
    });

    const json = await res.json() as { success: boolean; data?: T; error?: string };

    if (!res.ok || !json.success) {
      throw new Error(json.error || `Request failed: ${res.status}`);
    }

    return json.data as T;
  }

  return { apiFetch, publicFetch };
}
