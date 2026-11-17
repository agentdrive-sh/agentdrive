import type { CommentRecord } from './api-client';
import type { CommentEntry } from '../components/screens/comment-thread';

export function commentEntry(comment: CommentRecord): CommentEntry {
  return {
    id: comment.id ?? comment.comment_id ?? comment.created_at,
    author: comment.author_id ?? comment.author_agent_id ?? comment.author ?? comment.author_email ?? 'unknown',
    authorLabel: comment.author_name ?? comment.author_email ?? comment.author_id ?? comment.author_agent_id ?? comment.author ?? 'unknown',
    authorPlatform: comment.author_platform ?? null,
    text: comment.body,
    at: comment.created_at,
    resolved: comment.resolved,
  };
}
