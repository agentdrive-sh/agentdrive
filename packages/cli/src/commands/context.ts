import kleur from 'kleur';
import { CliApiClient } from '../lib/api-client.js';
import { requireLogin } from '../lib/config.js';

export interface ContextOptions {
  limit?: string;
  workspace?: string;
}

function truncate(s: string | undefined, n: number): string {
  if (!s) return '';
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

interface ContextArtifact {
  path: string;
  score: number | null;
  agent_id: string;
  agent_platform: string;
  snippet?: string;
  attribution?: { reasons: string[] };
  last_run?: { task: string; status: string; agent_platform: string };
}

export async function cmdContext(task: string | undefined, opts: ContextOptions = {}): Promise<void> {
  if (!task) {
    process.stderr.write('error: missing required argument <task>\n');
    process.exit(1);
  }

  const cfg = await requireLogin();
  const client = new CliApiClient({
    baseUrl: cfg.api_url,
    apiKey: cfg.api_key,
    agentPlatform: cfg.agent_platform ?? 'cli',
    agentRole: cfg.agent_role,
  });

  const limit = opts.limit ? Number.parseInt(opts.limit, 10) : undefined;
  const res = await client.context({
    task,
    workspace_id: opts.workspace ?? cfg.default_workspace,
    limit,
  });

  if (!res.artifacts.length) {
    process.stdout.write('No relevant artifacts.\n');
    return;
  }
  for (const a of res.artifacts as ContextArtifact[]) {
    const score = a.score === null ? 'keyword' : a.score.toFixed(2);
    process.stdout.write(
      `${kleur.cyan(a.path)} · score=${score} · by=${a.agent_id}@${a.agent_platform}\n`,
    );
    if (a.attribution?.reasons?.length) {
      process.stdout.write(`  ${kleur.dim('why: ' + a.attribution.reasons.join(' · '))}\n`);
    }
    if (a.last_run) {
      const lr = a.last_run;
      process.stdout.write(
        `  ${kleur.dim('last run: ' + truncate(lr.task, 80) + ` [${lr.status}, ${lr.agent_platform}]`)}\n`,
      );
    }
    if (a.snippet) process.stdout.write(`  ${kleur.dim(truncate(a.snippet, 500))}\n`);
  }
}
