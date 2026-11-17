import { cache } from 'react';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { serverApiClient } from './server-api';
import type { WorkspaceSummary } from './api-client';
import { getServerSession } from './session';
import { requireServerSession } from './server-session';
import { WORKSPACE_COOKIE } from './workspace-selection';

export interface ActiveWorkspace {
  workspaces: WorkspaceSummary[];
  current: WorkspaceSummary | null;
}

const listAccessibleWorkspaces = cache(async () => {
  const session = await getServerSession();
  if (!session?.api_key) return [];
  await requireServerSession();
  const client = serverApiClient(session);
  return client.listWorkspaces();
});

export async function resolveActiveWorkspace(requestedId?: string): Promise<ActiveWorkspace> {
  const workspaces = await listAccessibleWorkspaces();
  const savedId = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  // Both query and cookie are untrusted: only select an accessible workspace.
  const requested = requestedId && workspaces.find((w) => w.id === requestedId);
  if (requestedId && !requested) notFound();
  const current = requested || workspaces.find((w) => w.id === savedId) || workspaces[0] || null;
  return { workspaces, current };
}
