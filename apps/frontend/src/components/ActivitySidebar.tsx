import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../hooks/useApiClient';

interface ActivityEvent {
  id: string;
  action: string;
  actor_type: 'agent' | 'human';
  actor_id: string;
  target_path?: string;
  created_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  'file.write': 'created',
  'file.update': 'updated',
  'file.delete': 'deleted',
  'comment.add': 'commented on',
  'share.create': 'shared',
  'workspace.create': 'created workspace',
  'role.assign': 'assigned role',
  'role.remove': 'removed role',
};

export default function ActivitySidebar({ workspaceId }: { workspaceId: string }) {
  const { apiFetch } = useApiClient();

  const activityQuery = useQuery({
    queryKey: ['activity', workspaceId],
    queryFn: () => apiFetch<ActivityEvent[]>(`/workspaces/${workspaceId}/activity?limit=20`),
    refetchInterval: 15_000,
  });

  const events = activityQuery.data ?? [];

  return (
    <div>
      <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Activity</h2>
      {events.length === 0 ? (
        <p className="text-xs text-zinc-600">No activity yet.</p>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div key={event.id} className="flex items-start gap-2 text-xs">
              <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold mt-0.5 shrink-0 ${
                event.actor_type === 'agent' ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'
              }`}>
                {event.actor_type === 'agent' ? 'A' : 'H'}
              </span>
              <div className="min-w-0">
                <p className="text-zinc-400 leading-relaxed">
                  <span className="text-zinc-300 font-medium">{truncateId(event.actor_id)}</span>
                  {' '}{ACTION_LABELS[event.action] || event.action}
                  {event.target_path && (
                    <span className="text-zinc-500 font-mono"> {event.target_path}</span>
                  )}
                </p>
                <p className="text-zinc-600">{formatTime(event.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function truncateId(id: string): string {
  if (id.length <= 16) return id;
  return id.slice(0, 14) + '…';
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}
