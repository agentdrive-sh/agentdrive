import Link from 'next/link';
import { serverApiClient } from '../../../lib/server-api';
import { requireServerSession } from '../../../lib/server-session';
import { Icon } from '../../../components/icon';
import {
  PlatformGlyph,
  PLATFORMS,
  type PlatformId,
} from '../../../components/platform-glyph';
import { PageHead, StatusPill } from '../../../components/shared';
import { PrincipalDiagram } from '../../../components/screens/principal-diagram';
import { humanTime } from '../../../lib/time';
import type { ApiClient, ApiKeyRecord, OrgAgent, OrgDetail, RunRecord } from '../../../lib/api-client';

const AGENT_COLUMNS = '24px 1.6fr 1fr 100px 110px 100px';
const DAY = 24 * 3600 * 1000;
// GET /v1/runs without params returns at most this many of the org's newest runs.
const RUNS_PAGE = 50;

export default async function AgentsPage() {
  const session = await requireServerSession();
  const client = serverApiClient(session);

  let org: OrgDetail | null = null;
  let keys: ApiKeyRecord[] = [];
  let runs: RunRecord[] = [];
  if (session?.api_key) {
    const [orgRes, keysRes, runsRes] = await Promise.all([
      client.getOrg(),
      listAllKeys(client),
      client.listRuns(),
    ]);
    org = orgRes;
    keys = keysRes;
    runs = runsRes.items;
  }

  const lastUsed = new Map<string, number>();
  const seen = (agentId: string, at: number) => {
    if (!Number.isNaN(at) && at > (lastUsed.get(agentId) ?? 0)) lastUsed.set(agentId, at);
  };
  for (const k of keys) if (k.last_used_at) seen(k.agent_id, Date.parse(k.last_used_at));
  for (const r of runs) if (r.agent_id) seen(r.agent_id, r.created_at);

  const agents: OrgAgent[] = org?.agents ?? [];
  const principalId = org?.id ?? 'prin_—';

  return (
    <div className="fade-in" style={{ maxWidth: 1240, margin: '0 auto' }}>
      <PageHead
        sub={
          <>
            Every API key resolves to{' '}
            <span className="fg-0">one principal</span>. Headers (
            <span className="mono fg-0">X-Agent-Platform</span>,{' '}
            <span className="mono fg-0">X-Agent-Role</span>) tell us which
            agent on which tool made each call.
          </>
        }
        actions={
          <>
            <Link href="/keys" className="btn">
              <Icon name="key" size={13} /> Manage keys
            </Link>
            <Link href="/onboarding" className="btn primary">
              <Icon name="plus" size={13} /> Wire a new agent
            </Link>
          </>
        }
      />

      <div
        className="surface"
        style={{
          padding: 22,
          marginBottom: 20,
          background:
            'linear-gradient(180deg, var(--bg-1) 0%, var(--bg-2) 200%)',
        }}
      >
        <div
          className="row gap-6"
          style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}
        >
          <div style={{ flex: '1 1 280px' }}>
            <div
              className="t-xs muted wt-600"
              style={{
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 8,
              }}
            >
              The principal model
            </div>
            <div
              className="t-sm muted"
              style={{ lineHeight: 1.65 }}
            >
              You are{' '}
              <span className="fg-0 mono">{principalId}</span> across every
              tool. Each tool stamps its identity per-request. One seat,
              every agent.
            </div>
          </div>
          <div style={{ flex: '0 1 auto', minWidth: 0 }}>
            <PrincipalDiagram principalId={principalId} />
          </div>
        </div>
      </div>

      <div className="surface table-scroll">
        <div
          className="row-item"
          style={{
            gridTemplateColumns: AGENT_COLUMNS,
            gap: 14,
            padding: '8px 16px',
            background: 'var(--bg-2)',
            borderBottom: '1px solid var(--border)',
            fontSize: 10.5,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-3)',
            fontWeight: 600,
          }}
        >
          <span />
          <span>Agent</span>
          <span>Platform · Role</span>
          <span title={`Among the org's latest ${RUNS_PAGE} runs`}>Recent runs</span>
          <span>Last seen</span>
          <span style={{ textAlign: 'right' }}>Status</span>
        </div>

        {agents.length === 0 && (
          <div className="empty">
            <Icon name="plug" size={24} />
            <h3>No agents wired yet</h3>
            <p>
              Run the installer or paste the MCP block from{' '}
              <Link href="/onboarding">Onboarding</Link> to connect Claude
              Code, Codex, Cursor, or any MCP-aware tool.
            </p>
          </div>
        )}

        {agents.map((a) => {
          const agentRuns = runs.filter((r) => r.agent_id === a.agent_id);
          const latest = agentRuns[0];
          const platform = (latest?.agent_platform ?? guessPlatform(a.agent_name)) as PlatformId;
          const role = latest?.agent_role;
          const meta = PLATFORMS[platform] ?? PLATFORMS.unknown;
          const usedAt = lastUsed.get(a.agent_id);
          const status = a.revoked_at
            ? 'revoked'
            : usedAt && Date.now() - usedAt < DAY
              ? 'active'
              : 'idle';
          return (
            <div
              key={a.agent_id}
              className="row-item"
              style={{
                gridTemplateColumns: AGENT_COLUMNS,
                gap: 14,
                padding: '14px 16px',
              }}
            >
              <PlatformGlyph platform={platform} size={14} />
              <div className="col" style={{ lineHeight: 1.25 }}>
                <span className="mono t-sm fg-0">
                  {a.agent_name ?? a.agent_id}
                </span>
                <span className="t-xs faint mono">{a.agent_id}</span>
              </div>
              <div className="col" style={{ lineHeight: 1.25 }}>
                <span className="t-sm fg-0">{meta.label}</span>
                {role && <span className="t-xs faint mono">role={role}</span>}
              </div>
              <span className="mono t-sm muted">{agentRuns.length}</span>
              <span className="mono t-sm muted">
                {usedAt ? humanTime(usedAt) : 'no record'}
              </span>
              <div style={{ textAlign: 'right' }}>
                <StatusPill status={status} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

async function listAllKeys(client: ApiClient): Promise<ApiKeyRecord[]> {
  const all: ApiKeyRecord[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const page = await client.listApiKeys(cursor);
    all.push(...page.items);
    if (!page.cursor) break;
    cursor = page.cursor;
  }
  return all;
}

function guessPlatform(name?: string): string {
  if (!name) return 'mcp';
  const n = name.toLowerCase();
  if (n.includes('claude')) return 'claude-code';
  if (n.includes('codex')) return 'codex';
  if (n.includes('opencode')) return 'opencode';
  if (n.includes('gemini')) return 'gemini-cli';
  if (n.includes('antigravity')) return 'antigravity';
  if (n.includes('cursor')) return 'cursor';
  if (n.includes('langgraph') || n.includes('langchain')) return 'langgraph';
  if (n.includes('cline')) return 'cline';
  if (n.includes('zed')) return 'zed';
  if (n.includes('continue')) return 'continue';
  return 'mcp';
}
