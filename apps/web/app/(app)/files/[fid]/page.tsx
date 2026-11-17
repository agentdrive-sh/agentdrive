import Link from 'next/link';
import { ApiError } from '../../../../lib/api-client';
import { collectPages } from '../../../../lib/pagination';
import { commentEntry } from '../../../../lib/comments';
import { serverApiClient } from '../../../../lib/server-api';
import { requireServerSession } from '../../../../lib/server-session';
import { resolveActiveWorkspace } from '../../../../lib/workspace';
import { humanTime } from '../../../../lib/time';
import type {
  CommentRecord,
  FileContent,
  FileSummary,
  FileVersionRecord,
  RunRecord,
} from '../../../../lib/api-client';
import { Icon } from '../../../../components/icon';
import { FileIcon, StatusPill } from '../../../../components/shared';
import { PlatformGlyph } from '../../../../components/platform-glyph';
import { ProvenanceRibbonDetailed } from '../../../../components/screens/provenance-ribbon-detailed';
import { ArtifactTabs } from '../../../../components/screens/artifact-tabs';
import { FileActions } from './file-actions';

interface PageProps {
  params: Promise<{ fid: string }>;
  searchParams: Promise<{ workspace?: string; path?: string }>;
}

function isFileContent(
  f: FileContent | FileSummary | null,
): f is FileContent {
  return !!f && typeof (f as FileContent).content === 'string';
}

export default async function FileDetailPage({ params, searchParams }: PageProps) {
  let { fid } = await params;
  const query = await searchParams;
  const session = await requireServerSession();
  const { current: ws } = await resolveActiveWorkspace(query.workspace);
  const client = serverApiClient(session);

  let file: FileContent | FileSummary | null = null;
  let versions: FileVersionRecord[] = [];
  let comments: CommentRecord[] = [];
  let relatedRuns: RunRecord[] = [];
  let loadError: string | null = null;

  if (session?.api_key && ws) {
    if (fid === 'by-path' && query.path) {
      const candidates = await collectPages((cursor) => client.listFiles(ws.id, query.path, cursor));
      fid = candidates.find((candidate) => candidate.path === query.path)?.id ?? '';
    }
    if (fid) {
      try { file = await client.getFile(ws.id, fid, true); }
      catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        loadError = 'This artifact does not exist in the selected workspace.';
      }
    }
    if (file) {
      [versions, comments, relatedRuns] = await Promise.all([
        collectPages((cursor) => client.listFileVersions(ws.id, fid, cursor)),
        collectPages((cursor) => client.listFileComments(ws.id, fid, cursor)),
        collectPages((cursor) => client.listRunsByArtifact(ws.id, fid, cursor)),
      ]);
      versions.sort((a, b) => b.version - a.version);
    }
  }

  if (!ws) {
    return (
      <div className="fade-in" style={{ maxWidth: 1240, margin: '0 auto' }}>
        <div className="empty surface">
          <Icon name="folder" size={24} />
          <h3>No workspace yet</h3>
          <p>
            Run <span className="mono fg-0">adrive init</span> in a project
            directory to create one.
          </p>
        </div>
      </div>
    );
  }

  if (!file) {
    return (
      <div className="fade-in" style={{ maxWidth: 1240, margin: '0 auto' }}>
        <div className="empty surface">
          <Icon name="folder" size={24} />
          <h3>Artifact not found</h3>
          <p>{loadError ?? `No file with id ${fid} in ${ws.name}.`}</p>
        </div>
      </div>
    );
  }

  const filePath = (file as FileSummary).path;
  const fileName = filePath.split('/').pop() ?? filePath;
  const ext = fileName.includes('.') ? fileName.split('.').pop() ?? '' : '';
  const kind: 'markdown' | 'typescript' | 'json' | 'text' =
    ext === 'md'
      ? 'markdown'
      : ext === 'ts' || ext === 'tsx'
        ? 'typescript'
        : ext === 'json'
          ? 'json'
          : 'text';

  const contentHash = isFileContent(file) ? file.content_hash : undefined;
  const content = isFileContent(file) ? file.content : '';
  const size = (file as FileSummary).size ?? 0;
  const versionN = (file as FileSummary).version ?? versions.length;
  const updatedAt = (file as FileSummary).updated_at;

  const authorVersion = versions[versions.length - 1];
  const lastVersion = versions[0];
  const authorPlatform =
    authorVersion?.author_platform ?? lastVersion?.author_platform ?? 'unknown';
  const lastEditPlatform =
    lastVersion?.author_platform ?? authorPlatform ?? 'unknown';

  const referencedPlatformSet = new Set<string>();
  for (const r of relatedRuns) {
    if (r.artifacts_referenced?.includes(fid)) {
      const plat =
        r.agent_platform ??
        (r.metadata?.agent_platform as string | undefined);
      if (plat && plat !== authorPlatform) referencedPlatformSet.add(plat);
    }
  }

  return (
    <div className="fade-in" style={{ maxWidth: 1240, margin: '0 auto' }}>

      <div
        className="row"
        style={{ marginBottom: 22, alignItems: 'flex-start', gap: 18, flexWrap: 'wrap' }}
      >
        <FileIcon kind={kind} />
        <div className="col grow" style={{ lineHeight: 1.25, minWidth: 0, flexBasis: 240 }}>
          <h1
            className="mono"
            style={{
              fontSize: 22,
              fontWeight: 600,
              margin: 0,
              color: 'var(--text-0)',
              letterSpacing: '-0.02em',
              overflowWrap: 'anywhere',
            }}
          >
            {filePath}
          </h1>
          <div
            className="row gap-3"
            style={{ marginTop: 10, flexWrap: 'wrap' }}
          >
            {contentHash && (
              <span className="t-xs faint mono">
                #{contentHash.slice(0, 12)}
              </span>
            )}
            <span className="t-xs muted">
              {(size / 1024).toFixed(1)} KB
            </span>
            <span className="t-xs muted">·</span>
            <span className="t-xs muted">
              v{versionN}
              {updatedAt && ' · last edit ' + humanTime(updatedAt)}
            </span>
            <span className="t-xs muted">·</span>
            <StatusPill status="ready" />
          </div>
        </div>
        <FileActions
          workspaceId={ws.id}
          fileId={fid}
          path={filePath}
          content={isFileContent(file) ? file.content : null}
        />
      </div>

      <ProvenanceRibbonDetailed
        authorPlatform={authorPlatform}
        authorRole={authorVersion?.author_role}
        lastEditPlatform={lastEditPlatform}
        lastEditRelative={updatedAt ? humanTime(updatedAt) : '—'}
        referencedPlatforms={Array.from(referencedPlatformSet)}
        refsCount={relatedRuns.length}
      />

      <div className="grid" style={{ gridTemplateColumns: '1.6fr 1fr', gap: 20 }}>
        <ArtifactTabs
          key={`${ws.id}:${fid}`}
          workspaceId={ws.id}
          fileId={fid}
          path={filePath}
          versions={versions.map((v) => ({
            v: v.version,
            platform: v.author_platform ?? 'unknown',
            author: v.author_agent_id ?? v.actor_id,
            at: v.created_at,
            hash: v.content_hash,
            note: v.message,
            diffAdd: undefined,
            diffDel: undefined,
          }))}
          comments={comments.map(commentEntry)}
          contentHash={contentHash}
          previewContent={content}
          totalVersions={versionN}
        />

        <div className="col gap-4">
          <div className="surface" style={{ padding: 16 }}>
            <div
              className="t-xs muted wt-600"
              style={{
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 12,
              }}
            >
              Metadata
            </div>
            <div className="col gap-3 t-sm">
              <Meta label="content_hash" mono>
                <span className="fg-0">
                  {contentHash
                    ? `sha256:${contentHash.slice(0, 16)}...`
                    : '—'}
                </span>
              </Meta>
              <Meta label="r2_key" mono>
                <span className="muted">
                  content/{contentHash ? contentHash.slice(0, 16) + '...' : '—'}
                </span>
              </Meta>
              <Meta label="kind">{kind}</Meta>
              <Meta label="workspace">{ws.name}</Meta>
              {updatedAt && (
                <Meta label="updated">
                  {new Date(updatedAt).toISOString().split('T')[0]}
                </Meta>
              )}
            </div>
          </div>

          <div className="surface" style={{ padding: 16 }}>
            <div
              className="row"
              style={{
                justifyContent: 'space-between',
                marginBottom: 12,
              }}
            >
              <div
                className="t-xs muted wt-600"
                style={{
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                Used in runs · {relatedRuns.length}
              </div>
              <Link href="/runs" className="btn ghost sm">
                All
              </Link>
            </div>
            {relatedRuns.length === 0 ? (
              <div className="t-sm faint">
                No runs have referenced or produced this artifact yet.
              </div>
            ) : (
              <div className="col gap-2">
                {relatedRuns.slice(0, 4).map((r) => {
                  const plat =
                    r.agent_platform ??
                    (r.metadata?.agent_platform as string | undefined) ??
                    'mcp';
                  return (
                    <Link
                      key={r.run_id}
                      href={`/runs/${encodeURIComponent(r.run_id)}`}
                      className="row gap-2 t-sm"
                      style={{ cursor: 'pointer' }}
                    >
                      <PlatformGlyph platform={plat} size={11} />
                      <span
                        className="grow"
                        style={{
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {r.task}
                      </span>
                      <StatusPill status={r.status} />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <div className="surface" style={{ padding: 16 }}>
            <div
              className="t-xs muted wt-600"
              style={{
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 12,
              }}
            >
              Quick access · MCP
            </div>
            <pre
              className="code"
              style={{ whiteSpace: 'nowrap', overflowX: 'auto' }}
            >
              {`drive_read({ workspace_id: "${ws.id}", path: "${filePath}" })`}
            </pre>
            <div style={{ height: 8 }} />
            <pre
              className="code"
              style={{ whiteSpace: 'nowrap', overflowX: 'auto' }}
            >
              {`drive_versions({ workspace_id: "${ws.id}", file_id: "${fid}" })`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function Meta({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="row gap-3" style={{ alignItems: 'baseline' }}>
      <span className="muted t-xs mono" style={{ minWidth: 110 }}>
        {label}
      </span>
      <span className={mono ? 'mono t-xs' : 't-sm'}>{children}</span>
    </div>
  );
}
