'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AgentDriveLogo } from '@/components/agentdrive-logo';
import { Icon, type IconName } from '@/components/icon';
import { CodeBlock } from '@/components/marketing/code-block';
import { InstallBlock } from '@/components/marketing/install-block';
import type { FileContent, FileSummary } from '@/lib/api-client';
import { clearClientSession, getClientSession } from '@/lib/session';
import { humanTime } from '@/lib/time';

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'https://app.agentdrive.sh').replace(/\/$/, '');

interface TokenInfo {
  workspace_id: string;
  file_id?: string;
  permission: string;
  email_gated: boolean;
  email_hint?: string;
  uses_left?: number | null;
}

type Result<T> =
  | { ok: true; data: T; cursor: string | null }
  | { ok: false; status: number; error: string };

async function call<T>(path: string, headers: Record<string, string> = {}): Promise<Result<T>> {
  try {
    const res = await fetch(`${API_URL}/v1${path}`, { headers, credentials: 'omit' });
    const body = (await res.json().catch(() => null)) as
      | { success?: boolean; data?: T; cursor?: string | null; error?: string }
      | null;
    if (!res.ok || !body?.success) {
      return { ok: false, status: res.status, error: body?.error ?? `Request failed (${res.status})` };
    }
    return { ok: true, data: body.data as T, cursor: body.cursor ?? null };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach AgentDrive. Check your connection and try again.' };
  }
}

const PERMISSION_LABEL: Record<string, string> = {
  view: 'View only',
  comment: 'Can comment',
  edit: 'Can edit',
  owner: 'Full access',
};

const PROSE = /(\.(md|markdown|mdx|txt|text)|\/[^./]*)$/i;
// Matches what `adrive resume <link>` accepts; uploads under sessions/<project>/files/ are not transcripts.
const SESSION_TRANSCRIPT = /^sessions\/[^/]+\/(?!files\/)[^/]+\/[^/]+\.md$/;
// Private Workspace ciphertext (isEncrypted in @adrive/mcp-server) cannot be resumed from a link.
const ENCRYPTED_PREFIX = 'agentdrive-encrypted:';

type Status = 'loading' | 'ready' | 'gone' | 'wrong-account' | 'error';

export default function SharedLinkPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [headers, setHeaders] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [open, setOpen] = useState<FileContent | null>(null);
  const [busy, setBusy] = useState(false);

  const loginUrl = `/login?next=${encodeURIComponent(`/s/${token}`)}`;
  // uses_left was read before this page's own content read spent one; the CLI needs another.
  const resumable =
    !!info?.file_id && !info.email_gated && (info.uses_left == null || info.uses_left >= 2) &&
    !!open && SESSION_TRANSCRIPT.test(open.path) && !open.content?.startsWith(ENCRYPTED_PREFIX);

  const fail = useCallback((r: { status: number; error: string }, gated: boolean) => {
    if (r.status === 401 && gated && /email/i.test(r.error)) setStatus('wrong-account');
    else if (r.status === 401) setStatus('gone');
    else {
      setMessage(r.error);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const meta = await call<TokenInfo>(`/token-info/${encodeURIComponent(token)}`);
      if (cancelled) return;
      if (!meta.ok) return fail(meta, false);
      setInfo(meta.data);

      const h: Record<string, string> = { 'X-Share-Token': token };
      if (meta.data.email_gated) {
        const session = getClientSession();
        if (!session?.api_key) return router.replace(loginUrl);
        h['X-Session-Token'] = session.api_key;
      }
      setHeaders(h);

      const wid = encodeURIComponent(meta.data.workspace_id);
      if (meta.data.file_id) {
        const file = await call<FileContent>(`/workspaces/${wid}/files/${encodeURIComponent(meta.data.file_id)}?content=true`, h);
        if (cancelled) return;
        if (!file.ok) return fail(file, meta.data.email_gated);
        setOpen(file.data);
      } else {
        const list = await call<FileSummary[]>(`/workspaces/${wid}/files`, h);
        if (cancelled) return;
        if (!list.ok) return fail(list, meta.data.email_gated);
        setFiles(list.data);
        setCursor(list.cursor);
      }
      setStatus('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router, loginUrl, fail]);

  async function openFile(id: string) {
    if (!info || busy) return;
    setBusy(true);
    const file = await call<FileContent>(
      `/workspaces/${encodeURIComponent(info.workspace_id)}/files/${encodeURIComponent(id)}?content=true`,
      headers,
    );
    setBusy(false);
    if (!file.ok) return fail(file, info.email_gated);
    setOpen(file.data);
    window.scrollTo(0, 0);
  }

  async function loadMore() {
    if (!info || !cursor || busy) return;
    setBusy(true);
    const list = await call<FileSummary[]>(
      `/workspaces/${encodeURIComponent(info.workspace_id)}/files?cursor=${encodeURIComponent(cursor)}`,
      headers,
    );
    setBusy(false);
    if (!list.ok) return fail(list, info.email_gated);
    setFiles((prev) => [...prev, ...list.data]);
    setCursor(list.cursor);
  }

  function switchAccount() {
    clearClientSession();
    router.push(loginUrl);
  }

  let body: ReactNode;
  if (status === 'loading') {
    body = <Notice icon="clock" title="Opening shared link…" />;
  } else if (status === 'gone') {
    body = (
      <Notice icon="lock" title="This link was revoked or has expired">
        Ask the person who shared it for a new link.
      </Notice>
    );
  } else if (status === 'wrong-account') {
    const email = getClientSession()?.email;
    body = (
      <Notice icon="lock" title={`This link is for ${info?.email_hint ?? 'a different email'}`}>
        {email ? `You're signed in as ${email}. ` : ''}Sign in with the address this link was shared with to open it.
        <div style={{ marginTop: 16 }}>
          <button type="button" className="btn primary" onClick={switchAccount}>
            Sign in with a different email
          </button>
        </div>
      </Notice>
    );
  } else if (status === 'error') {
    body = (
      <Notice icon="x" title="Couldn't open this link">
        {message}
      </Notice>
    );
  } else if (open) {
    body = (
      <>
        {!info?.file_id && (
          <button type="button" className="btn ghost sm" onClick={() => setOpen(null)} style={{ marginBottom: 12 }}>
            <Icon name="arrow-left" size={12} /> All files
          </button>
        )}
        {resumable && <ResumeBlock command={`npx -y @adrive/cli resume ${window.location.origin}/s/${token}`} />}
        <FileView file={open} />
      </>
    );
  } else {
    body = (
      <div className="surface" style={{ overflow: 'hidden' }}>
        {files.length === 0 ? (
          <Notice icon="folder" title="No files here yet" />
        ) : (
          files.map((f) => (
            <button
              key={f.id}
              type="button"
              className="row-item clickable"
              disabled={busy}
              onClick={() => openFile(f.id)}
              style={{
                gridTemplateColumns: '1fr auto',
                gap: 14,
                width: '100%',
                textAlign: 'left',
                background: 'none',
                border: 'none',
                borderBottom: '1px solid var(--border)',
                color: 'inherit',
                font: 'inherit',
              }}
            >
              <span className="row gap-2 fg-0 mono" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <Icon name="file" size={14} />
                {f.path}
              </span>
              <span className="t-xs muted">{humanTime(f.updated_at)}</span>
            </button>
          ))
        )}
        {cursor && (
          <div className="row" style={{ padding: 12, justifyContent: 'center' }}>
            <button type="button" className="btn ghost" disabled={busy} onClick={loadMore}>
              Load more
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="col" style={{ minHeight: '100vh', background: 'var(--bg-0)' }}>
      <header
        className="row"
        style={{
          justifyContent: 'space-between',
          gap: 12,
          padding: '14px 24px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <a href="https://agentdrive.sh" className="row gap-2" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
          <AgentDriveLogo size={20} />
          <span className="t-md wt-600 fg-0">AgentDrive</span>
        </a>
        {status === 'ready' && info && (
          <span className="pill">
            <Icon name="eye" size={12} />
            {PERMISSION_LABEL[info.permission] ?? info.permission}
          </span>
        )}
      </header>

      <main className="grow" style={{ width: '100%', maxWidth: 960, margin: '0 auto', padding: '28px 16px' }}>
        {body}
      </main>

      <footer className="t-xs muted" style={{ textAlign: 'center', padding: '20px 16px 28px' }}>
        Shared with{' '}
        <a href="https://agentdrive.sh" className="fg-0" style={{ textDecoration: 'none' }}>
          AgentDrive
        </a>
        {status !== 'loading' && !resumable && (
          <>
            , the workspace your agents share. Install it to save and share your own sessions:
            <div className="row" style={{ justifyContent: 'center', marginTop: 10, textAlign: 'left' }}>
              <InstallBlock />
            </div>
          </>
        )}
      </footer>
    </div>
  );
}

function Notice({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={24} />
      <h3>{title}</h3>
      {children && <div className="t-sm">{children}</div>}
    </div>
  );
}

function ResumeBlock({ command }: { command: string }) {
  return (
    <section className="surface" style={{ padding: '20px 24px', marginBottom: 16, borderColor: 'var(--accent)' }}>
      <h2 className="t-md wt-600 fg-0" style={{ margin: '0 0 6px' }}>
        Resume this session in your agent
      </h2>
      <p className="t-sm muted" style={{ margin: '0 0 14px' }}>
        Loads the goal, files touched and recent turns into Claude Code, Codex, Cursor, OpenCode or Antigravity.
      </p>
      <CodeBlock label="Copy resume command">{command}</CodeBlock>
    </section>
  );
}

function FileView({ file }: { file: FileContent }) {
  const prose = PROSE.test(`/${file.path}`);
  return (
    <article className="surface" style={{ overflow: 'hidden' }}>
      <div
        className="row"
        style={{
          justifyContent: 'space-between',
          gap: 12,
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
        }}
      >
        <h1 className="mono t-sm wt-600 fg-0" style={{ margin: 0, wordBreak: 'break-all' }}>
          {file.path}
        </h1>
        <span className="t-xs muted">
          v{file.version} · updated {humanTime(file.updated_at)}
        </span>
      </div>
      {file.content ? (
        <pre
          className={prose ? undefined : 'code'}
          style={
            prose
              ? {
                  margin: 0,
                  padding: '20px 24px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--fs-body)',
                  lineHeight: 'var(--lh-body)',
                  color: 'var(--text-1)',
                  maxWidth: 'var(--measure)',
                }
              : { margin: 0, border: 'none', borderRadius: 0, padding: '16px 20px' }
          }
        >
          {file.content}
        </pre>
      ) : (
        <Notice icon="file" title="This file is empty" />
      )}
    </article>
  );
}
