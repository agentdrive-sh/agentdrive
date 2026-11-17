import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../hooks/useApiClient';
import { useToken } from '../contexts/TokenContext';

interface WorkspaceMeta {
  id: string;
  name: string;
  created_at: string;
  created_by: string;
}

interface OrgData {
  id: string;
  name: string;
  plan: string;
  agents: { agent_id: string; agent_name?: string }[];
  members: { email: string; role: string }[];
  usage: { workspace_count: number; agent_count: number; member_count: number; storage_bytes: number };
  quota: { max_workspaces: number };
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { isLoggedIn, email, clearSession, sessionId } = useToken();
  const { apiFetch } = useApiClient();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');

  if (!isLoggedIn) {
    return <Navigate to="/" replace />;
  }

  const workspacesQuery = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => apiFetch<WorkspaceMeta[]>('/workspaces'),
    enabled: !!sessionId,
    refetchInterval: 15_000,
  });

  const orgQuery = useQuery({
    queryKey: ['org'],
    queryFn: () => apiFetch<OrgData>('/org'),
    enabled: !!sessionId,
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      return apiFetch<WorkspaceMeta>('/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
    },
    onSuccess: (ws) => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      setShowCreate(false);
      setNewName('');
      navigate(`/w/${ws.id}`);
    },
  });

  const workspaces = workspacesQuery.data ?? [];
  const org = orgQuery.data;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Nav */}
      <header className="border-b border-zinc-800/50">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
              </svg>
            </div>
            <span className="text-sm font-semibold">AgentDrive</span>
            {org && <span className="text-xs text-zinc-600 ml-2">{org.name}</span>}
          </div>
          <div className="flex items-center gap-3">
            {org && (
              <span className="text-xs text-zinc-500 px-2 py-1 bg-zinc-900 rounded border border-zinc-800">
                {org.plan}
              </span>
            )}
            <span className="text-xs text-zinc-400">{email}</span>
            <Link
              to="/billing"
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Manage plan
            </Link>
            <button
              onClick={() => { clearSession(); navigate('/login'); }}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold">Workspaces</h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              {workspaces.length} workspace{workspaces.length !== 1 ? 's' : ''}
              {org && ` · ${org.usage.agent_count} agent${org.usage.agent_count !== 1 ? 's' : ''}`}
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-3.5 py-2 bg-emerald-500 text-black text-sm font-medium rounded-lg hover:bg-emerald-400 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New
          </button>
        </div>

        {/* Create workspace inline */}
        {showCreate && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4 animate-in">
            <div className="flex gap-3">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newName.trim()) createMutation.mutate(newName.trim());
                  if (e.key === 'Escape') { setShowCreate(false); setNewName(''); }
                }}
                placeholder="Workspace name"
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 transition-colors"
                autoFocus
              />
              <button
                onClick={() => newName.trim() && createMutation.mutate(newName.trim())}
                disabled={!newName.trim() || createMutation.isPending}
                className="px-4 py-2 bg-emerald-500 text-black text-sm font-medium rounded-lg hover:bg-emerald-400 disabled:opacity-50 transition-colors"
              >
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </button>
              <button
                onClick={() => { setShowCreate(false); setNewName(''); }}
                className="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Cancel
              </button>
            </div>
            {createMutation.error && (
              <p className="text-xs text-red-400 mt-2">{createMutation.error.message}</p>
            )}
          </div>
        )}

        {/* Workspace list */}
        {workspacesQuery.isLoading ? (
          <div className="text-center py-12 text-zinc-500 text-sm">Loading...</div>
        ) : workspaces.length === 0 ? (
          <div className="bg-zinc-900/50 border border-zinc-800/50 border-dashed rounded-xl p-12 text-center">
            <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-zinc-400 text-sm mb-1">No workspaces yet</p>
            <p className="text-zinc-600 text-xs">Create one above, or let an agent set one up for you with <code className="text-zinc-500">drive_write</code> from Claude Code, Codex, or Cursor.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {workspaces.map((ws) => (
              <Link
                key={ws.id}
                to={`/w/${ws.id}`}
                className="group bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4 hover:border-zinc-700 hover:bg-zinc-900/80 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-white group-hover:text-emerald-400 transition-colors">{ws.name}</h3>
                    <p className="text-xs text-zinc-500 mt-1">
                      by {ws.created_by} · {formatTime(ws.created_at)}
                    </p>
                  </div>
                  <svg className="w-4 h-4 text-zinc-700 group-hover:text-zinc-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Agents section */}
        {org && org.agents.length > 0 && (
          <div className="mt-10">
            <h2 className="text-sm font-semibold text-zinc-400 mb-3">Agents</h2>
            <div className="flex flex-wrap gap-2">
              {org.agents.map((agent) => (
                <div key={agent.agent_id} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg">
                  <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px] font-bold">A</span>
                  <span className="text-xs text-zinc-300">{agent.agent_name || agent.agent_id}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
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
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
