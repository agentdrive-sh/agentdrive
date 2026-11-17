import kleur from 'kleur';
import { CliApiClient } from '../lib/api-client.js';
import { requireLogin } from '../lib/config.js';

export interface RunLogOptions {
  status?: 'success' | 'failure' | 'partial' | 'in_progress';
  duration?: string;
  ref?: string[];
  produced?: string[];
  workspace?: string;
}

export async function cmdRunLog(task: string, opts: RunLogOptions = {}): Promise<void> {
  const cfg = await requireLogin();
  const client = new CliApiClient({
    baseUrl: cfg.api_url,
    apiKey: cfg.api_key,
    agentPlatform: cfg.agent_platform ?? 'cli',
    agentRole: cfg.agent_role,
  });

  const duration = opts.duration ? Number.parseInt(opts.duration, 10) : undefined;
  const res = await client.logRun({
    task,
    status: opts.status ?? 'success',
    artifacts_referenced: opts.ref,
    artifacts_produced: opts.produced,
    duration_ms: duration,
  });
  process.stdout.write(`${kleur.green('[ok]')} run logged: ${res.run_id}\n`);
}
