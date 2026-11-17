import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../hooks/useApiClient';
import { useToken } from '../contexts/TokenContext';
import ActivitySidebar from '../components/ActivitySidebar';

interface FileMeta {
  id: string;
  path: string;
  version: number;
  size: number;
  updated_at: string;
  updated_by: string;
}

interface WorkspaceMeta {
  id: string;
  name: string;
  created_at: string;
}

export default function WorkspaceView() {
  const { wid } = useParams<{ wid: string }>();
  const navigate = useNavigate();
  const { apiFetch } = useApiClient();
  const { permission, email, isLoggedIn } = useToken();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [showShare, setShowShare] = useState(false);
  const [sharePermission, setSharePermission] = useState<'view' | 'comment' | 'edit'>('view');
  const [shareEmail, setShareEmail] = useState('');
  const [shareUrl, setShareUrl] = useState('');

  const canEdit = permission === 'edit' || permission === 'owner' || isLoggedIn;

  const workspaceQuery = useQuery({
    queryKey: ['workspace', wid],
    queryFn: () => apiFetch<WorkspaceMeta>(`/workspaces/${wid}`),
    enabled: !!wid,
  });

  const filesQuery = useQuery({
    queryKey: ['files', wid],
    queryFn: () => apiFetch<FileMeta[]>(`/workspaces/${wid}/files`),
    enabled: !!wid,
    refetchInterval: 10_000,
  });

  const createFileMutation = useMutation({
    mutationFn: async (path: string) => {
      return apiFetch<FileMeta>(`/workspaces/${wid}/files`, {
        method: 'POST',
        body: JSON.stringify({ path, content: '', message: 'Created from dashboard' }),
      });
    },
    onSuccess: (file) => {
      queryClient.invalidateQueries({ queryKey: ['files', wid] });
      setShowCreate(false);
      setNewPath('');
      navigate(`/w/${wid}/f/${file.id}`);
    },
  });

  const shareMutation = useMutation({
    mutationFn: async () => {
      return apiFetch<{ url: string }>(`/workspaces/${wid}/share`, {
        method: 'POST',
        body: JSON.stringify({
          permission: sharePermission,
          email: shareEmail.trim() || undefined,
        }),
      });
    },
    onSuccess: (data) => {
      setShareUrl(data.url);
    },
  });

  if (workspaceQuery.isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-500 text-sm">Loading workspace...</div>
      </div>
    );
  }

  if (workspaceQuery.error) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
        <div className="bg-zinc-900 border border-red-900/30 rounded-xl p-8 max-w-md text-center">
          <p className="text-sm text-zinc-400">{workspaceQuery.error.message}</p>
        </div>
      </div>
    );
  }

  const workspace = workspaceQuery.data;
  const files = filesQuery.data ?? [];

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Nav */}
      <header className="border-b border-zinc-800/50">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isLoggedIn && (
              <Link to="/" className="text-zinc-500 hover:text-zinc-300 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
            )}
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <svg className="w-3 h-3 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h1 className="text-sm font-semibold">{workspace?.name || wid}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {permission && !isLoggedIn && (
              <span className="text-xs text-zinc-500 px-2 py-1 bg-zinc-900 rounded border border-zinc-800">{permission}</span>
            )}
            {email && <span className="text-xs text-zinc-500">{email}</span>}
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto flex gap-6 p-6">
        <main className="flex-1 min-w-0">
          {/* Actions bar */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-zinc-500">
              {files.length} file{files.length !== 1 ? 's' : ''}
            </p>
            <div className="flex gap-2">
              {canEdit && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="px-3 py-1.5 bg-emerald-500 text-black text-xs font-medium rounded-lg hover:bg-emerald-400 transition-colors flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  New File
                </button>
              )}
              <button
                onClick={() => setShowShare(!showShare)}
                className="px-3 py-1.5 bg-zinc-800 text-zinc-300 text-xs font-medium rounded-lg hover:bg-zinc-700 transition-colors flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                Share
              </button>
            </div>
          </div>

          {/* Create file */}
          {showCreate && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4 animate-in">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newPath.trim()) createFileMutation.mutate(newPath.trim());
                    if (e.key === 'Escape') { setShowCreate(false); setNewPath(''); }
                  }}
                  placeholder="filename.md"
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 font-mono focus:outline-none focus:border-emerald-500/50 transition-colors"
                  autoFocus
                />
                <button
                  onClick={() => newPath.trim() && createFileMutation.mutate(newPath.trim())}
                  disabled={!newPath.trim() || createFileMutation.isPending}
                  className="px-4 py-2 bg-emerald-500 text-black text-sm font-medium rounded-lg hover:bg-emerald-400 disabled:opacity-50 transition-colors"
                >
                  Create
                </button>
              </div>
              {createFileMutation.error && (
                <p className="text-xs text-red-400 mt-2">{createFileMutation.error.message}</p>
              )}
            </div>
          )}

          {/* Share panel */}
          {showShare && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4 animate-in">
              <div className="space-y-3">
                <div className="flex gap-2">
                  {(['view', 'comment', 'edit'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setSharePermission(p)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                        sharePermission === p
                          ? 'bg-emerald-500 text-black'
                          : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <input
                  type="email"
                  value={shareEmail}
                  onChange={(e) => setShareEmail(e.target.value)}
                  placeholder="Restrict to email (optional)"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 transition-colors"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => shareMutation.mutate()}
                    disabled={shareMutation.isPending}
                    className="px-4 py-2 bg-emerald-500 text-black text-sm font-medium rounded-lg hover:bg-emerald-400 disabled:opacity-50 transition-colors"
                  >
                    {shareMutation.isPending ? 'Creating...' : 'Create Link'}
                  </button>
                  {shareUrl && (
                    <button
                      onClick={() => { navigator.clipboard.writeText(shareUrl); }}
                      className="px-4 py-2 bg-zinc-800 text-zinc-300 text-sm font-medium rounded-lg hover:bg-zinc-700 transition-colors"
                    >
                      Copy Link
                    </button>
                  )}
                </div>
                {shareUrl && (
                  <p className="text-xs text-emerald-400 font-mono break-all">{shareUrl}</p>
                )}
                {shareMutation.error && (
                  <p className="text-xs text-red-400">{shareMutation.error.message}</p>
                )}
              </div>
            </div>
          )}

          {/* File list */}
          {files.length === 0 ? (
            <div className="bg-zinc-900/50 border border-zinc-800/50 border-dashed rounded-xl p-12 text-center">
              <p className="text-zinc-500 text-sm">No files yet</p>
              <p className="text-zinc-600 text-xs mt-1">Your agents will populate this workspace. Files written by Claude Code, Codex, Cursor, or any agent platform appear here with full version history.</p>
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800/50">
              {files.map((file) => (
                <Link
                  key={file.id}
                  to={`/w/${wid}/f/${file.id}`}
                  className="group flex items-center justify-between px-4 py-3 hover:bg-zinc-800/30 transition-colors first:rounded-t-xl last:rounded-b-xl"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-200 group-hover:text-emerald-400 transition-colors truncate font-mono">
                      {file.path}
                    </p>
                    <p className="text-xs text-zinc-600 mt-0.5">
                      v{file.version} · {formatSize(file.size)} · {formatTime(file.updated_at)} · {file.updated_by}
                    </p>
                  </div>
                  <svg className="w-4 h-4 text-zinc-700 group-hover:text-zinc-500 transition-colors shrink-0 ml-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              ))}
            </div>
          )}
        </main>

        {/* Activity sidebar */}
        <aside className="w-72 shrink-0 hidden lg:block">
          <ActivitySidebar workspaceId={wid!} />
        </aside>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
