'use client';

import { useState } from 'react';
import { Icon } from '../icon';
import { PlatformGlyph } from '../platform-glyph';
import type { PlatformId } from '../platform-glyph';

export interface CommentEntry {
  id: string;
  author: string;
  authorPlatform?: PlatformId | string | null;
  authorLabel?: string;
  text: string;
  at: string;
  resolved?: boolean;
}

interface Props {
  comments: CommentEntry[];
  humanRelative: (iso: string) => string;
  onPost: (text: string) => Promise<CommentEntry>;
}

export function CommentThread({ comments, humanRelative, onPost }: Props) {
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(event: React.FormEvent) {
    event.preventDefault();
    if (posting || !draft.trim()) return;
    setPosting(true);
    setError(null);
    try {
      await onPost(draft.trim());
      setDraft('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save your comment. Please retry.');
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="col gap-4">
      {comments.length === 0 && (
        <div className="empty">
          <h3>No comments yet</h3>
          <p>
            Any connected agent can post via{' '}
            <span className="mono">drive_comment</span>.
          </p>
        </div>
      )}
      {comments.map((c) => {
        const initials = (c.authorLabel ?? c.author).slice(0, 2).toUpperCase();
        return (
          <div
            key={c.id}
            className="row gap-3"
            style={{
              alignItems: 'flex-start',
              padding: '12px 0',
              borderBottom: '1px solid var(--border)',
            }}
          >
            {c.authorPlatform ? (
              <div style={{ flexShrink: 0 }}>
                <PlatformGlyph platform={c.authorPlatform} size={14} />
              </div>
            ) : (
              <div className="avatar">{initials}</div>
            )}
            <div className="grow">
              <div className="row gap-2">
                <span className="t-sm wt-600 fg-0">
                  {c.authorLabel ?? c.author}
                </span>
                <span className="t-xs muted">{humanRelative(c.at)}</span>
                {c.resolved && (
                  <span className="pill success" style={{ height: 18 }}>
                    <Icon name="check" size={9} /> resolved
                  </span>
                )}
              </div>
              <div
                className="t-sm"
                style={{
                  marginTop: 6,
                  color: 'var(--text-1)',
                  lineHeight: 1.55,
                }}
              >
                {c.text}
              </div>
            </div>
          </div>
        );
      })}
      <form className="row gap-2" style={{ marginTop: 8 }} onSubmit={post}>
        <input
          aria-label="Add a comment"
          maxLength={5000}
          disabled={posting}
          className="input"
          placeholder="Add a comment... (any connected agent can reply via drive_comment)"
          style={{ height: 38 }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="submit"
          className="btn primary"
          disabled={posting || !draft.trim()}
        >
          {posting ? 'Posting…' : 'Post'}
        </button>
      </form>
      <p className="t-xs muted">New comments may take a moment to appear after reloading.</p>
      {error && <p role="alert" className="t-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  );
}
