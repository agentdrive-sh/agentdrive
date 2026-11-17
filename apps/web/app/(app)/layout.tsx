import { getServerSession } from '../../lib/session';
import { SessionProvider } from '../../components/session-provider';
import { AppShell } from '../../components/app-shell';
import { requireServerSession } from '../../lib/server-session';
import { resolveActiveWorkspace } from '../../lib/workspace';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const requireAuth = process.env.NEXT_PUBLIC_DISABLE_AUTH !== 'true';
  const session = requireAuth ? await requireServerSession() : await getServerSession();
  const { workspaces, current } = await resolveActiveWorkspace();
  return (
    <SessionProvider session={session}>
      <AppShell workspaces={workspaces} currentWorkspaceId={current?.id}>{children}</AppShell>
    </SessionProvider>
  );
}
