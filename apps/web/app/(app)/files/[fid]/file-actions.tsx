'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient, type CreatedShare } from '../../../../lib/api-client';
import { getClientSession } from '../../../../lib/session';
import { Icon } from '../../../../components/icon';
import { CopyButton, CopyableCode } from '../../../../components/shared';

type Permission = 'view' | 'comment' | 'edit';

const EXPIRY: Array<{ label: string; seconds?: number }> = [
  { label: 'Never expires' },
  { label: 'Expires in 1 day', seconds: 86_400 },
  { label: 'Expires in 7 days', seconds: 7 * 86_400 },
  { label: 'Expires in 30 days', seconds: 30 * 86_400 },
];

// Uploaded copies live under sessions/<project>/files/, and a share link can't decrypt a
// Private Workspace transcript, so neither is offered as resumable.
const SESSION_TRANSCRIPT = /^sessions\/[^/]+\/(?!files\/)[^/]+\/[^/]+\.md$/;
const ENCRYPTED_PREFIX = 'agentdrive-encrypted:';

interface FileActionsProps {
  workspaceId: string;
  fileId: string;
  path: string;
  content: string | null;
}

export function FileActions({ workspaceId, fileId, path, content }: FileActionsProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const shareButton = useRef<HTMLButtonElement>(null);

  const pull = () => {
    if (content == null) return;
    const href = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = href;
    a.download = path.split('/').pop() || 'artifact';
    a.click();
    URL.revokeObjectURL(href);
  };

  const closeShare = () => {
    setShareOpen(false);
    shareButton.current?.focus();
  };

  return (
    <div className="row gap-2 file-actions" style={{ position: 'relative', flexWrap: 'wrap' }}>
      <button type="button" className="btn sm" onClick={pull} disabled={content == null}>
        <Icon name="download" size={12} /> Pull
      </button>
      <button
        ref={shareButton}
        type="button"
        className="btn sm"
        aria-expanded={shareOpen}
        aria-controls="file-share-form"
        onClick={() => setShareOpen((v) => !v)}
      >
        <Icon name="share" size={12} /> Share
      </button>
      {content != null && <CopyButton text={content} label="Copy" />}
      {shareOpen && (
        <ShareForm
          workspaceId={workspaceId}
          fileId={fileId}
          resumable={SESSION_TRANSCRIPT.test(path) && !content?.startsWith(ENCRYPTED_PREFIX)}
          onClose={closeShare}
        />
      )}
    </div>
  );
}

function ShareForm({
  workspaceId,
  fileId,
  resumable,
  onClose,
}: {
  workspaceId: string;
  fileId: string;
  resumable: boolean;
  onClose: () => void;
}) {
  const client = useMemo(() => ApiClient.fromSession(getClientSession()), []);
  const [permission, setPermission] = useState<Permission>('view');
  const [expiry, setExpiry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<CreatedShare | null>(null);
  const first = useRef<HTMLSelectElement>(null);

  useEffect(() => first.current?.focus(), []);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      setShare(
        await client.createShare(workspaceId, {
          permission,
          file_id: fileId,
          expires_in: EXPIRY[expiry].seconds,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      id="file-share-form"
      role="dialog"
      aria-label="Share this artifact"
      className="surface col gap-3 share-pop"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="t-sm wt-600 fg-0">Share link to this file</span>
        <button type="button" className="btn ghost sm" onClick={onClose} aria-label="Close">
          <Icon name="x" size={12} />
        </button>
      </div>
      {share ? (
        <>
          <CopyableCode oneLine>{share.url}</CopyableCode>
          {resumable && (
            <>
              <span className="t-xs muted">Resume this session in another harness:</span>
              <CopyableCode oneLine>{`npx -y @adrive/cli resume ${share.url}`}</CopyableCode>
            </>
          )}
          <span className="t-xs faint">
            {share.permission} access
            {share.expires_at ? ` · expires ${new Date(share.expires_at).toLocaleString()}` : ' · no expiry'}
            {' · revoke it from Shares'}
          </span>
        </>
      ) : (
        <>
          <select
            ref={first}
            className="input"
            aria-label="Permission"
            value={permission}
            onChange={(e) => setPermission(e.target.value as Permission)}
          >
            <option value="view">Can view</option>
            <option value="comment">Can comment</option>
            <option value="edit">Can edit</option>
          </select>
          <select
            className="input"
            aria-label="Expiry"
            value={expiry}
            onChange={(e) => setExpiry(Number(e.target.value))}
          >
            {EXPIRY.map((o, i) => (
              <option key={o.label} value={i}>
                {o.label}
              </option>
            ))}
          </select>
          <button type="button" className="btn primary sm" disabled={busy} onClick={create}>
            {busy ? 'Creating…' : 'Create link'}
          </button>
          {error && (
            <span className="t-xs" role="alert" style={{ color: 'var(--danger, #f87171)' }}>
              {error}
            </span>
          )}
        </>
      )}
    </div>
  );
}
