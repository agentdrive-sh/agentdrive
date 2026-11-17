import kleur from 'kleur';
import { CliApiClient } from '../lib/api-client.js';
import { requireLogin } from '../lib/config.js';

export interface SearchOptions {
  topK?: string;
  platform?: string;
  workspace?: string;
}

function truncate(s: string | undefined, n: number): string {
  if (!s) return '';
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

export async function cmdSearch(query: string, opts: SearchOptions = {}): Promise<void> {
  const cfg = await requireLogin();
  const client = new CliApiClient({
    baseUrl: cfg.api_url,
    apiKey: cfg.api_key,
    agentPlatform: cfg.agent_platform ?? 'cli',
    agentRole: cfg.agent_role,
  });

  const topK = opts.topK ? Number.parseInt(opts.topK, 10) : undefined;
  const filter: Record<string, string> = {};
  if (opts.platform) filter.agent_platform = opts.platform;

  const res = await client.search({
    query,
    workspace_id: opts.workspace ?? cfg.default_workspace,
    top_k: topK,
    filter: Object.keys(filter).length ? filter : undefined,
  });

  if (!res.hits.length) {
    process.stdout.write('No results.\n');
    return;
  }
  for (const h of res.hits) {
    const score = h.score === null ? 'keyword' : h.score.toFixed(2);
    process.stdout.write(
      `${kleur.cyan(h.path)} · score=${score} · by=${h.agent_id}@${h.agent_platform}\n`,
    );
    if (h.snippet) process.stdout.write(`  ${kleur.dim(truncate(h.snippet, 200))}\n`);
  }
}
