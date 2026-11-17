import { buildHandoff, isEncrypted } from '@adrive/mcp-server/session';
import type { ApiEnvelope, FileContent } from '../lib/api-client.js';
import { DEFAULT_API_URL, readConfig } from '../lib/config.js';

interface TokenInfo {
  workspace_id: string;
  file_id?: string;
  email_gated: boolean;
  email_hint?: string;
}

const TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
// Uploaded copies live under sessions/<project>/files/, so that folder is not a harness.
const SESSION_TRANSCRIPT = /^sessions\/[^/]+\/(?!files\/)[^/]+\/[^/]+\.md$/;

// Returns null for anything that is not a share link, so run ids keep their meaning.
export function parseShareToken(arg: string): string | null {
  let token = arg.trim();
  if (token.includes('/')) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(token) ? token : `https://${token}`);
    } catch {
      throw new Error(`Not an AgentDrive share link: ${arg}`);
    }
    const host = url.hostname.toLowerCase();
    const match = /^\/s\/([^/]+)\/?$/.exec(url.pathname);
    if ((host !== 'agentdrive.sh' && !host.endsWith('.agentdrive.sh')) || !match) {
      throw new Error(`Not an AgentDrive share link: ${arg}`);
    }
    token = match[1]!;
    if (!isShareToken(token)) throw new Error(`This share link is malformed: ${arg}`);
    return token;
  }
  return isShareToken(token) ? token : null;
}

function isShareToken(token: string): boolean {
  if (!TOKEN.test(token)) return false;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8')) as { wid?: unknown };
    return typeof payload?.wid === 'string';
  } catch {
    return false;
  }
}

// Never sends the saved API key: the worker would authenticate the key and ignore the link.
async function get<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { 'X-Share-Token': token } });
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (res.status === 401) {
    throw new Error(
      `This share link no longer works (${body?.error ?? 'unauthorized'}): it was revoked, expired or used up. Ask the person who shared it for a new link.`,
    );
  }
  if (!res.ok || !body?.success) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body.data as T;
}

export async function cmdResumeShare(token: string, opts: { maxChars?: number; fromLink?: boolean } = {}): Promise<void> {
  // A link names the agentdrive.sh service that issued it; only a bare token falls back to the configured API.
  const base = opts.fromLink ? DEFAULT_API_URL : ((await readConfig())?.api_url ?? DEFAULT_API_URL);
  const api = `${base.replace(/\/$/, '')}/v1`;
  const info = await get<TokenInfo>(`${api}/token-info/${token}`, token);
  if (!info.file_id) {
    throw new Error('This link shares a whole workspace, not a session transcript. Open it in a browser instead.');
  }
  if (info.email_gated) {
    throw new Error(
      `This link is restricted to ${info.email_hint ?? 'one email address'}. Open it in a browser and sign in as that address.`,
    );
  }

  const file = `${api}/workspaces/${encodeURIComponent(info.workspace_id)}/files/${encodeURIComponent(info.file_id)}`;
  // Metadata reads do not count against max_uses, so check the path before spending a use.
  const meta = await get<FileContent>(file, token);
  if (!SESSION_TRANSCRIPT.test(meta.path)) {
    throw new Error(`This link shares ${meta.path}, which is not a session transcript, so there is nothing to resume.`);
  }
  const { content } = await get<FileContent>(`${file}?content=true`, token);
  if (typeof content !== 'string') {
    throw new Error(`The transcript ${meta.path} has no stored content. Ask the person who shared it to sync the session again.`);
  }
  if (isEncrypted(content)) {
    throw new Error(
      'This session is end-to-end encrypted (Private Workspace), so a share link cannot decrypt it. Ask the person who shared it to resume it from their own login.',
    );
  }
  process.stdout.write(`${buildHandoff(content, opts.maxChars)}\n`);
}
