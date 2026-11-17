import { serverApiClient } from '../../../lib/server-api';
import { requireServerSession } from '../../../lib/server-session';
import { resolveActiveWorkspace } from '../../../lib/workspace';
import { Icon } from '../../../components/icon';
import { PageHead } from '../../../components/shared';
import { FilesTable } from '../../../components/screens/files-table';
import type { FileRowData } from '../../../components/screens/file-row';

export default async function FilesPage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const session = await requireServerSession();
  const { current } = await resolveActiveWorkspace((await searchParams).workspace);
  const client = serverApiClient(session);

  const page = current ? await client.listFiles(current.id) : { items: [], cursor: null };
  const files = page.items as FileRowData[];

  return (
    <div className="fade-in" style={{ maxWidth: 1240, margin: '0 auto' }}>
      <PageHead
        sub={
          <>
            Content-addressed artifacts across all your agents · workspace{' '}
            <span className="mono fg-0">{current?.name ?? '—'}</span>
          </>
        }
      />

      {current ? (
        <FilesTable key={current.id} initialFiles={files} initialCursor={page.cursor} workspaceId={current.id} />
      ) : (
        <div className="empty surface">
          <Icon name="folder" size={24} />
          <h3>No workspace yet</h3>
          <p>
            Run <span className="mono fg-0">adrive init</span> in a project
            directory to create one, then any wired agent starts filling it.
          </p>
        </div>
      )}
    </div>
  );
}
