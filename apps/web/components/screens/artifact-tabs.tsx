'use client';

import { useState } from 'react';
import { humanTime } from '../../lib/time';
import { CommentThread } from './comment-thread';
import type { CommentEntry } from './comment-thread';
import { VersionTimeline } from './version-timeline';
import type { VersionEntry } from './version-timeline';
import { ApiClient } from '@/lib/api-client';
import { useSession } from '../session-provider';
import { commentEntry } from '@/lib/comments';

type Tab = 'overview' | 'versions' | 'comments';

interface Props {
  path: string;
  versions: VersionEntry[];
  comments: CommentEntry[];
  contentHash?: string;
  previewContent: string;
  totalVersions: number;
  workspaceId: string;
  fileId: string;
}

const PREVIEW_LINES = 30;

export function ArtifactTabs({
  path,
  versions,
  comments,
  contentHash,
  previewContent,
  totalVersions,
  workspaceId,
  fileId,
}: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  // Keep acknowledged writes for this artifact while server reads propagate.
  // This is page state only; it is discarded when the artifact unmounts.
  const [postedComments, setPostedComments] = useState<CommentEntry[]>([]);
  const commentItems = [
    ...postedComments.filter((posted) => !comments.some((comment) => comment.id === posted.id)),
    ...comments,
  ];
  const session = useSession();

  return (
    <div>
      <div className="tabs">
        {(
          [
            ['overview', 'Overview'],
            ['versions', 'Versions'],
            ['comments', 'Comments'],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <button
            type="button"
            key={key}
            className={'tab' + (tab === key ? ' active' : '')}
            onClick={() => setTab(key)}
          >
            {label}
            {key === 'versions' && totalVersions > 0 && (
              <span className="count">{totalVersions}</span>
            )}
            {key === 'comments' && commentItems.length > 0 && (
              <span className="count">{commentItems.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="surface" style={{ padding: 24, minHeight: 480 }}>
          <div
            className="t-xs muted wt-600"
            style={{
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginBottom: 10,
            }}
          >
            File preview · first {PREVIEW_LINES} lines
          </div>
          <pre
            className="code"
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 360,
              overflowY: 'auto',
            }}
          >
            {previewContent
              ? previewContent
                  .split('\n')
                  .slice(0, PREVIEW_LINES)
                  .join('\n') ||
                '(empty file)'
              : 'No preview available.'}
          </pre>
          <div
            style={{
              marginTop: 18,
              paddingTop: 18,
              borderTop: '1px solid var(--border)',
            }}
            className="row gap-4"
          >
            <Counter label="Versions" val={totalVersions} />
            <Counter label="Comments" val={commentItems.length} />
            <Counter label="Path" val={path} mono small />
          </div>
        </div>
      )}

      {tab === 'versions' && (
        <div className="surface" style={{ padding: 24 }}>
          <div className="t-sm muted" style={{ marginBottom: 18 }}>
            Every version is content-addressed and immutable. The same agent
            on the same platform pushing the same bytes is a no-op
            (idempotent).
          </div>
          <VersionTimeline versions={versions} humanRelative={humanTime} />
        </div>
      )}

      {tab === 'comments' && (
        <div className="surface" style={{ padding: 24 }}>
          <CommentThread
            comments={commentItems}
            humanRelative={humanTime}
            onPost={async (text) => {
              const created = commentEntry(await ApiClient.fromSession(session).addFileComment(workspaceId, fileId, text));
              setPostedComments((previous) => [created, ...previous.filter((comment) => comment.id !== created.id)]);
              return created;
            }}
          />
        </div>
      )}

    </div>
  );
}

function Counter({
  label,
  val,
  mono,
  small,
}: {
  label: string;
  val: number | string;
  mono?: boolean;
  small?: boolean;
}) {
  return (
    <div className="col" style={{ minWidth: 0 }}>
      <span
        className="t-xs muted wt-600"
        style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}
      >
        {label}
      </span>
      <span
        className={mono ? 'mono fg-0' : 'fg-0'}
        style={{
          marginTop: 4,
          fontSize: small ? 12 : 16,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 480,
        }}
      >
        {val}
      </span>
    </div>
  );
}
