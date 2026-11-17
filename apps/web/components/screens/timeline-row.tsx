import Link from 'next/link';
import { PlatformGlyph } from '../platform-glyph';
import { humanTime } from '../../lib/time';
import type { ActivityEvent } from '../../lib/api-client';

// Phase 3 dense Linear-style table row (design decision D3 "1A Dense table").
// Six logical columns on desktop; collapses to a card-list on mobile via the
// .timeline-row class in globals.css. Platform glyph uses the locked tinted
// pill variant from D4 ("2A Tinted pill with letter glyph").

const VERB_LABELS: Record<string, string> = {
  'file.write': 'wrote',
  'file.update': 'updated',
  'file.delete': 'deleted',
  'comment.add': 'commented on',
  'share.create': 'shared',
  'share.revoke': 'revoked share',
  'workspace.create': 'created workspace',
  'role.assign': 'assigned role',
  'role.remove': 'removed role',
};

interface TimelineRowProps {
  event: ActivityEvent;
}

function shortActor(ev: ActivityEvent): string {
  if (ev.actor_type === 'human') return ev.actor_id;
  return ev.actor_id.length > 14 ? `${ev.actor_id.slice(0, 14)}…` : ev.actor_id;
}

export function TimelineRow({ event }: TimelineRowProps) {
  const platform = event.agent_platform ?? event.metadata?.agent_platform ?? 'mcp';
  const verb = VERB_LABELS[event.action] ?? event.action;
  const target = event.target_path ?? event.target_id;
  const wsHref = `/files?ws=${encodeURIComponent(event.workspace_id)}`;

  return (
    <div className="timeline-row" role="row">
      <div className="timeline-cell timeline-platform" role="cell">
        <PlatformGlyph platform={platform} size={11} />
      </div>
      <div className="timeline-cell timeline-actor mono t-xs muted" role="cell">
        {shortActor(event)}
      </div>
      <div className="timeline-cell timeline-action t-sm fg-0" role="cell">
        {verb}
      </div>
      <div className="timeline-cell timeline-target mono t-sm fg-0" role="cell">
        {target}
      </div>
      <div className="timeline-cell timeline-workspace t-xs muted" role="cell">
        <Link href={wsHref} className="link-muted">
          ws:{event.workspace_id.slice(0, 8)}
        </Link>
      </div>
      <div className="timeline-cell timeline-time t-xs faint" role="cell">
        {humanTime(event.created_at)}
      </div>
    </div>
  );
}

export function TimelineHead() {
  return (
    <div className="timeline-row timeline-head" role="row">
      <div className="timeline-cell" role="columnheader">Agent</div>
      <div className="timeline-cell" role="columnheader">Principal</div>
      <div className="timeline-cell" role="columnheader">Action</div>
      <div className="timeline-cell" role="columnheader">Target</div>
      <div className="timeline-cell" role="columnheader">Workspace</div>
      <div className="timeline-cell" role="columnheader">Time</div>
    </div>
  );
}
