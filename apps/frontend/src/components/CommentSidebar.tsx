import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../hooks/useApiClient';
import { useToken } from '../contexts/TokenContext';

interface Comment {
  id: string;
  body: string;
  author_type: 'agent' | 'human';
  author_id: string;
  author_name?: string;
  created_at: string;
  line_start?: number;
  line_end?: number;
}

interface CommentSidebarProps {
  workspaceId: string;
  fileId: string;
  canComment: boolean;
}

export default function CommentSidebar({ workspaceId, fileId, canComment }: CommentSidebarProps) {
  const { apiFetch } = useApiClient();
  const { email } = useToken();
  const queryClient = useQueryClient();
  const [newComment, setNewComment] = useState('');

  const commentsQuery = useQuery({
    queryKey: ['comments', workspaceId, fileId],
    queryFn: () => apiFetch<Comment[]>(`/workspaces/${workspaceId}/files/${fileId}/comments`),
    refetchInterval: 10_000,
  });

  const addCommentMutation = useMutation({
    mutationFn: async () => {
      await apiFetch(`/workspaces/${workspaceId}/files/${fileId}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          body: newComment,
          author_name: email || undefined,
        }),
      });
    },
    onSuccess: () => {
      setNewComment('');
      queryClient.invalidateQueries({ queryKey: ['comments', workspaceId, fileId] });
    },
  });

  const comments = commentsQuery.data ?? [];

  return (
    <div className="p-4 flex flex-col h-full">
      <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
        Comments {comments.length > 0 && `(${comments.length})`}
      </h2>

      <div className="flex-1 overflow-y-auto space-y-3 mb-4">
        {comments.length === 0 ? (
          <p className="text-xs text-zinc-600">No comments yet.</p>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className="bg-zinc-900 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  comment.author_type === 'agent' ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'
                }`}>
                  {comment.author_type === 'agent' ? 'A' : 'H'}
                </span>
                <span className="text-xs font-medium text-zinc-300 truncate">
                  {comment.author_name || comment.author_id}
                </span>
                <span className="text-[10px] text-zinc-600 ml-auto shrink-0">
                  {formatTime(comment.created_at)}
                </span>
              </div>
              {comment.line_start && (
                <p className="text-[10px] text-zinc-600 mb-1">
                  Line{comment.line_end && comment.line_end !== comment.line_start ? `s ${comment.line_start}–${comment.line_end}` : ` ${comment.line_start}`}
                </p>
              )}
              <p className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">{comment.body}</p>
            </div>
          ))
        )}
      </div>

      {canComment && (
        <div className="border-t border-zinc-800/50 pt-3 space-y-2">
          <textarea
            placeholder="Add a comment..."
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && newComment.trim()) {
                addCommentMutation.mutate();
              }
            }}
            rows={3}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500/30 resize-none transition-colors"
          />
          <button
            onClick={() => addCommentMutation.mutate()}
            disabled={!newComment.trim() || addCommentMutation.isPending}
            className="w-full px-3 py-1.5 bg-emerald-500 text-black text-xs font-medium rounded-lg hover:bg-emerald-400 disabled:opacity-50 transition-colors"
          >
            {addCommentMutation.isPending ? 'Posting...' : 'Post'}
          </button>
          {addCommentMutation.error && (
            <p className="text-[11px] text-red-400">{addCommentMutation.error.message}</p>
          )}
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return `${Math.floor(diffHr / 24)}d`;
}
