import { getCloudflareContext } from '@opennextjs/cloudflare';
import { ApiClient } from './api-client';
import type { WebSession } from './session';

interface ServiceBinding {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

// app.agentdrive.sh is this worker's own custom domain, with only /v1/* routed to the API
// worker, and a worker's subrequest to its own zone skips that route. Server code therefore
// reaches the API through the API service binding, never the public URL.
export function serverApiClient(session: WebSession | null): ApiClient {
  let api: ServiceBinding | undefined;
  try {
    api = (getCloudflareContext().env as { API?: ServiceBinding }).API;
  } catch {
    // `next dev` runs without a Cloudflare context; the public URL works from a local process.
  }
  return new ApiClient({ apiKey: session?.api_key, fetch: api && ((url, init) => api.fetch(url, init)) });
}
