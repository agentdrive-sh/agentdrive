import Link from 'next/link';
import { ApiError, type ApiClient } from '../../../../lib/api-client';
import { serverApiClient } from '../../../../lib/server-api';
import { requireServerSession } from '../../../../lib/server-session';
import { resolveActiveWorkspace } from '../../../../lib/workspace';
import { humanTime } from '../../../../lib/time';
import type {
  FileSummary,
  RunRecord,
} from '../../../../lib/api-client';
import { Icon } from '../../../../components/icon';
import { CopyButton, FileIcon, StatusPill } from '../../../../components/shared';
import { PlatformChip, PlatformGlyph } from '../../../../components/platform-glyph';
import { RunGraph } from '../../../../components/screens/run-graph';
import type { GraphFile } from '../../../../components/screens/run-graph';

interface PageProps {
  params: Promise<{ rid: string }>;
}

function getMeta<T>(r: RunRecord, key: string): T | undefined {
  return (r.metadata?.[key] as T | undefined) ?? undefined;
}

async function loadFileSummary(
  client: ApiClient,
  wsId: string,
  id: string,
): Promise<GraphFile | null> {
  try {
    const f = (await client.getFile(wsId, id, false)) as FileSummary;
    return {
      id: f.id,
      path: f.path,
      hash: (f as FileSummary & { content_hash?: string }).content_hash ?? '',
      size: f.size,
      version: f.version,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export default async function RunDetailPage({ params }: PageProps) {
  const { rid } = await params;
  const session = await requireServerSession();
  const { current: ws } = await resolveActiveWorkspace();
  const client = serverApiClient(session);

  let run: RunRecord | null = null;
  let referenced: GraphFile[] = [];
  let produced: GraphFile[] = [];
  let loadError: string | null = null;

  if (session?.api_key && ws) {
    try {
      run = await client.getRun(rid);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      loadError = 'This run does not exist in your organization.';
    }

    if (run) {
      const [refSettled, prodSettled] = await Promise.all([
        Promise.all(
          (run.artifacts_referenced ?? []).map((id) =>
            loadFileSummary(client, ws.id, id),
          ),
        ),
        Promise.all(
          (run.artifacts_produced ?? []).map((id) =>
            loadFileSummary(client, ws.id, id),
          ),
        ),
      ]);
      referenced = refSettled.filter((x): x is GraphFile => x !== null);
      produced = prodSettled.filter((x): x is GraphFile => x !== null);
    }
  }

  if (!ws) {
    return (
      <div className="fade-in" style={{ maxWidth: 1240, margin: '0 auto' }}>
        <div className="empty surface">
          <Icon name="play" size={24} />
          <h3>No workspace yet</h3>
          <p>
            Run <span className="mono fg-0">adrive init</span> in a project
            directory to create one.
          </p>
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="fade-in" style={{ maxWidth: 1240, margin: '0 auto' }}>
        <div className="empty surface">
          <Icon name="play" size={24} />
          <h3>Run not found</h3>
          <p>
            {loadError ??
              `No run with id ${rid} in ${ws.name}. It may have been logged against a different workspace, or expired from the listing window.`}
          </p>
        </div>
      </div>
    );
  }

  const platform =
    run.agent_platform ??
    getMeta<string>(run, 'agent_platform') ??
    'mcp';
  const role = run.agent_role ?? getMeta<string>(run, 'agent_role');
  const durationS = (run.duration_ms ?? 0) / 1000;
  const tokens = getMeta<number>(run, 'tokens') ?? 0;
  const embeddings = getMeta<number>(run, 'embeddings') ?? 0;
  const usd = getMeta<number>(run, 'usd') ?? 0;
  const status = run.status ?? 'in_progress';

  return (
    <div className="fade-in" style={{ maxWidth: 1240, margin: '0 auto' }}>

      <div className="row gap-3" style={{ marginBottom: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row gap-2" style={{ marginBottom: 8 }}>
            <span className="mono t-xs faint">{run.run_id}</span>
            <span className="t-xs faint">·</span>
            <StatusPill status={status} />
          </div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              margin: 0,
              letterSpacing: '-0.02em',
              color: 'var(--text-0)',
              overflowWrap: 'anywhere',
            }}
          >
            {run.task}
          </h1>
          <div className="row gap-3" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            <PlatformChip platform={platform} />
            {role && (
              <>
                <span className="t-xs muted mono">role={role}</span>
                <span className="t-xs faint">·</span>
              </>
            )}
            <span className="t-xs muted">
              started {humanTime(run.created_at)}
            </span>
            <span className="t-xs faint">·</span>
            <span className="t-xs muted mono">
              {durationS.toFixed(1)}s
            </span>
          </div>
        </div>
        <CopyButton text={JSON.stringify(run, null, 2)} label="Copy run.json" />
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}
      >
        <Stat label="Duration" val={durationS.toFixed(1)} unit="s" />
        <Stat
          label="Tokens"
          val={tokens ? (tokens / 1000).toFixed(1) + 'k' : '—'}
          sub={`${embeddings} embeddings`}
        />
        <Stat
          label="Cost"
          val={usd ? `$${usd.toFixed(2)}` : '—'}
          sub="inference + embed"
        />
        <Stat
          label="Artifacts"
          val={`+${produced.length} / ↪${referenced.length}`}
          sub="produced / referenced"
        />
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns: '1.5fr 1fr', gap: 20 }}
      >
        <div className="col gap-4">
          <div>
            <div
              className="t-xs muted wt-600"
              style={{
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 10,
              }}
            >
              Provenance graph
            </div>
            <RunGraph
              platform={platform}
              role={role}
              referenced={referenced}
              produced={produced}
            />
          </div>

        </div>

        <div className="col gap-4">
          <div className="surface" style={{ padding: 18 }}>
            <SectionLabel>Identity</SectionLabel>
            <div className="col gap-3 t-sm">
              <Meta label="run_id" mono>
                <span className="muted">{run.run_id}</span>
              </Meta>
              <Meta label="agent_platform" mono>
                <span className="fg-0">{platform}</span>
              </Meta>
              <Meta label="agent_role" mono>
                <span className="fg-0">{role ?? 'not set'}</span>
              </Meta>
              <Meta label="status" mono>
                <span className="fg-0">{status}</span>
              </Meta>
              <Meta label="logged_at" mono>
                <span className="muted">
                  {new Date(run.created_at).toISOString()}
                </span>
              </Meta>
            </div>
          </div>

          <div className="surface" style={{ padding: 18 }}>
            <SectionLabel>Artifacts produced</SectionLabel>
            {produced.length === 0 && (
              <div className="t-sm faint">No artifacts produced.</div>
            )}
            {produced.map((f) => (
              <Link
                key={f.id}
                href={`/files/${encodeURIComponent(f.id)}`}
                className="row gap-2 t-sm"
                style={{ padding: '6px 0' }}
              >
                <FileIcon kind={kindFor(f.path)} />
                <span
                  className="mono fg-0 grow"
                  style={{
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {f.path}
                </span>
                <span className="t-xs faint mono">v{f.version ?? 1}</span>
              </Link>
            ))}
          </div>

          <div className="surface" style={{ padding: 18 }}>
            <SectionLabel>Artifacts referenced</SectionLabel>
            {referenced.length === 0 && (
              <div className="t-sm faint">Nothing referenced.</div>
            )}
            {referenced.map((f) => (
              <Link
                key={f.id}
                href={`/files/${encodeURIComponent(f.id)}`}
                className="row gap-2 t-sm"
                style={{ padding: '6px 0' }}
              >
                <FileIcon kind={kindFor(f.path)} />
                <span
                  className="mono muted grow"
                  style={{
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {f.path}
                </span>
                <PlatformGlyph platform={f.platform ?? 'mcp'} size={10} />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="t-xs muted wt-600"
      style={{
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        marginBottom: 12,
      }}
    >
      {children}
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

function Stat({
  label,
  val,
  unit,
  sub,
}: {
  label: string;
  val: string;
  unit?: string;
  sub?: string;
}) {
  return (
    <div className="stat">
      <div className="lbl">{label}</div>
      <div className="val">
        {val}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {sub && (
        <div className="t-xs faint" style={{ marginTop: 6 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function kindFor(path: string): 'markdown' | 'typescript' | 'json' | 'text' {
  const ext = path.split('.').pop() ?? '';
  if (ext === 'md') return 'markdown';
  if (ext === 'ts' || ext === 'tsx') return 'typescript';
  if (ext === 'json') return 'json';
  return 'text';
}

