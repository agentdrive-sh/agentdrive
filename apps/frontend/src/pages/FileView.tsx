import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../hooks/useApiClient';
import { useToken } from '../contexts/TokenContext';
import MarkdownEditor from '../components/MarkdownEditor';
import CommentSidebar from '../components/CommentSidebar';

interface FileData {
  id: string;
  path: string;
  content: string;
  content_hash: string;
  version: number;
  size: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
}

interface FileVersion {
  version: number;
  actor_type: 'agent' | 'human';
  actor_id: string;
  created_at: string;
  message?: string;
}

export default function FileView() {
  const { wid, fid } = useParams<{ wid: string; fid: string }>();
  const { apiFetch } = useApiClient();
  const { permission, isLoggedIn } = useToken();
  const [showVersions, setShowVersions] = useState(false);

  const canEdit = permission === 'edit' || permission === 'owner' || isLoggedIn;
  const canComment = permission === 'comment' || canEdit;

  const fileQuery = useQuery({
    queryKey: ['file', wid, fid],
    queryFn: () => apiFetch<FileData>(`/workspaces/${wid}/files/${fid}?content=true`),
    enabled: !!wid && !!fid,
  });

  const versionsQuery = useQuery({
    queryKey: ['versions', wid, fid],
    queryFn: () => apiFetch<FileVersion[]>(`/workspaces/${wid}/files/${fid}/versions`),
    enabled: !!wid && !!fid && showVersions,
  });

  if (fileQuery.isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-500 text-sm">Loading file...</div>
      </div>
    );
  }

  if (fileQuery.error) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
        <div className="bg-zinc-900 border border-red-900/30 rounded-xl p-8 max-w-md text-center">
          <p className="text-sm text-zinc-400">{fileQuery.error.message}</p>
        </div>
      </div>
    );
  }

  const file = fileQuery.data!;
  const versions = versionsQuery.data ?? [];

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Nav */}
      <header className="border-b border-zinc-800/50">
        <div className="max-w-7xl mx-auto px-6 h-12 flex items-center gap-3">
          <Link to={`/w/${wid}`} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex-1 min-w-0 flex items-center gap-3">
            <h1 className="text-sm font-medium text-zinc-200 truncate font-mono">{file.path}</h1>
            <span className="text-xs text-zinc-600 shrink-0">v{file.version}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowVersions(!showVersions)}
              className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                showVersions ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              History
            </button>
            <span className="text-xs text-zinc-600">
              {file.updated_by} · {formatTime(file.updated_at)}
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto flex h-[calc(100vh-49px)]">
        {/* Editor */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-3xl mx-auto py-6 px-6">
            <MarkdownEditor
              content={file.content}
              editable={canEdit}
              onSave={async (content) => {
                await apiFetch(`/workspaces/${wid}/files/${fid}`, {
                  method: 'PUT',
                  body: JSON.stringify({ content }),
                });
                fileQuery.refetch();
              }}
            />
          </div>
        </main>

        {/* Right panel: versions or comments */}
        <aside className="w-72 border-l border-zinc-800/50 overflow-y-auto shrink-0 hidden lg:block">
          {showVersions ? (
            <div className="p-4">
              <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Version History</h2>
              {versionsQuery.isLoading ? (
                <p className="text-xs text-zinc-600">Loading...</p>
              ) : versions.length === 0 ? (
                <p className="text-xs text-zinc-600">No version history.</p>
              ) : (
                <div className="space-y-2">
                  {versions.map((v) => (
                    <div key={v.version} className="bg-zinc-900 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-zinc-200">v{v.version}</span>
                        <span className="text-[10px] text-zinc-600">{formatTime(v.created_at)}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
                          v.actor_type === 'agent' ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'
                        }`}>
                          {v.actor_type === 'agent' ? 'A' : 'H'}
                        </span>
                        <span className="text-xs text-zinc-500 truncate">{v.actor_id}</span>
                      </div>
                      {v.message && (
                        <p className="text-xs text-zinc-500 mt-1 italic">"{v.message}"</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <CommentSidebar workspaceId={wid!} fileId={fid!} canComment={canComment} />
          )}
        </aside>
      </div>
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
