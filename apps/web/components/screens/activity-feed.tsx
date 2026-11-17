import { Icon } from '../icon';
import { PlatformChip } from '../platform-glyph';
import { humanTime } from '../../lib/time';
import type { ActivityEvent } from '../../lib/api-client';

const VERB_LABELS: Record<string, string> = {
  'file.write': 'wrote',
  'file.update': 'updated',
  'file.delete': 'deleted',
  'comment.add': 'commented on',
  'share.create': 'shared',
  'share.revoke': 'revoked share',
  'workspace.create': 'created workspace',
  'role.assign': 'assigned role on',
  'role.remove': 'removed role on',
};

interface ActivityFeedProps {
  events: ActivityEvent[];
}

export function ActivityFeed({ events }: ActivityFeedProps) {
  if (events.length === 0) {
    return (
      <div className="empty">
        <Icon name="clock" size={24} />
        <h3>No activity yet</h3>
        <p>
          Once your agents start reading and writing artifacts, every action
          shows up here with full cross-platform provenance.
        </p>
      </div>
    );
  }
  return (
    <div className="table-scroll">
      {events.map((a) => {
        const platform = a.agent_platform ?? a.metadata?.agent_platform ?? 'mcp';
        const verb = VERB_LABELS[a.action] ?? a.action;
        const target = a.target_path ?? a.target_id;
        return (
          <div
            key={a.id}
            className="row-item"
            style={{
              gridTemplateColumns: '140px 1fr 110px',
              gap: 14,
            }}
          >
            <PlatformChip platform={platform} />
            <div>
              <span className="muted">{verb}</span>{' '}
              <span className="mono fg-0">{target}</span>
            </div>
            <div
              className="t-xs faint"
              style={{ textAlign: 'right' }}
            >
              {humanTime(a.created_at)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
