export const WORKSPACE_COOKIE = 'adrive_workspace';

export function workspaceFileHref(workspaceId: string, fileId: string): string {
  return `/files/${encodeURIComponent(fileId)}?workspace=${encodeURIComponent(workspaceId)}`;
}

export function rememberWorkspace(workspaceId: string): void {
  document.cookie = `${WORKSPACE_COOKIE}=${encodeURIComponent(workspaceId)}; path=/; max-age=2592000; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`;
}

export function selectWorkspace(workspaceId: string, pathname: string): void {
  rememberWorkspace(workspaceId);
  // A file id belongs to its workspace; switching project returns to its file list.
  const target = pathname.startsWith('/files/') ? '/files' : pathname;
  window.location.assign(`${target}?workspace=${encodeURIComponent(workspaceId)}`);
}
