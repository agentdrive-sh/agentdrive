import { HARNESSES, LOCAL_NOTE, findLocalSession, listLocalSessions, localHandoff, type LocalToolContext } from '@adrive/mcp-server/local';
import { projectKeyFor, scopeProjectKey } from '@adrive/mcp-server/project';
import { buildHandoff, isEncrypted, sessionActivityAt, type SessionHarness } from '@adrive/mcp-server/session';
import { CliApiClient, type RunRecord } from '../lib/api-client.js';
import { configDir, readConfig, type CliConfig } from '../lib/config.js';
import { decryptContentAsync } from '../lib/crypto.js';
import { resumeAgentPlatform } from '../lib/harness-env.js';
import { cmdResumeShare, parseShareToken } from './resume-share.js';

export interface ResumeOptions {
  list?: boolean;
  maxChars?: number;
  // Read this machine's harness transcripts even when logged in.
  local?: boolean;
  // The agent this runs in, for one whose shell has no marker to detect (Antigravity).
  as?: string;
}

function title(run: RunRecord): string {
  const t = run.metadata?.title;
  return typeof t === 'string' && t ? t : run.task;
}

async function cmdResumeLocal(id: string | undefined, opts: ResumeOptions, cfg: CliConfig | null): Promise<void> {
  const ctx: LocalToolContext = {
    cwd: process.cwd(),
    exclude: opts.as || resumeAgentPlatform(process.env, cfg?.agent_platform),
    env: process.env,
    configDir: configDir(),
  };
  process.stderr.write(`${LOCAL_NOTE}${cfg?.api_key ? '' : ' Run `adrive init` to sync and share sessions.'}\n`);

  if (opts.list) {
    const { project, sessions } = await listLocalSessions(ctx);
    if (sessions.length === 0) {
      process.stdout.write(`No local sessions from other agents for project ${project}.\n`);
      return;
    }
    for (const s of sessions) {
      process.stdout.write(`${s.id}  ${s.harness}  ${new Date(s.activityAt).toISOString()}  ${s.title || 'Untitled session'}\n`);
    }
    return;
  }

  if (id) {
    const session = await findLocalSession(id, ctx);
    if (!session) throw new Error(`No local session ${id} on this machine.`);
    process.stdout.write(`${localHandoff(session, opts.maxChars)}\n`);
    return;
  }
  const { project, sessions } = await listLocalSessions({ ...ctx, limit: 1 });
  if (!sessions[0]) throw new Error(`No local sessions from other agents for project ${project}.`);
  process.stdout.write(`${localHandoff(sessions[0], opts.maxChars)}\n`);
}

export async function cmdResume(id: string | undefined, opts: ResumeOptions = {}): Promise<void> {
  const shareToken = id ? parseShareToken(id) : null;
  if (shareToken) return cmdResumeShare(shareToken, { ...opts, fromLink: id!.includes('/') });
  const cfg = await readConfig();
  if (opts.as && !HARNESSES.includes(opts.as as SessionHarness)) {
    throw new Error(`Unknown agent: ${opts.as}. Supported: ${HARNESSES.join(', ')}.`);
  }
  if (opts.local || !cfg?.api_key) return cmdResumeLocal(id, opts, cfg);
  const self = opts.as || resumeAgentPlatform(process.env, cfg.agent_platform);
  const client = new CliApiClient({
    baseUrl: cfg.api_url,
    apiKey: cfg.api_key,
    agentPlatform: self,
    agentRole: cfg.agent_role,
  });
  const project = scopeProjectKey(projectKeyFor(process.cwd()), !!cfg.preferences?.private_workspace);

  if (opts.list) {
    const runs = await client.listRuns({ project, limit: 10 });
    if (runs.length === 0) {
      process.stdout.write(`No sessions for project ${project}.\n`);
      return;
    }
    for (const r of runs) {
      const when = new Date(sessionActivityAt(r)).toISOString();
      process.stdout.write(`${r.run_id}  ${r.agent_platform}  ${when}  ${title(r)}\n`);
    }
    return;
  }

  let run: RunRecord | undefined;
  if (id) run = await client.getRun(id);
  else {
    const runs = await client.listRuns({ project, limit: 20 });
    run = runs.find((r) => r.agent_platform !== self);
    if (!run && runs[0]) {
      run = runs[0];
      process.stderr.write(`No session from an agent other than ${self} for project ${project}; resuming the newest one, from ${run.agent_platform}.\n`);
    }
  }
  if (!run) throw new Error(`No sessions for project ${project}.`);
  const transcriptPath = run.metadata?.transcript_path;
  if (typeof transcriptPath !== 'string' || !run.workspace_id) {
    throw new Error(`Session ${run.run_id} has no uploaded transcript.`);
  }
  const file = await client.readFileByPath(run.workspace_id, transcriptPath);
  if (file.usage_warning) {
    const { message, upgrade_url } = file.usage_warning;
    process.stderr.write(message.includes(upgrade_url) ? `${message}\n` : `${message}\nUpgrade: ${upgrade_url}\n`);
  }
  const encrypted = isEncrypted(file.content);
  const markdown = encrypted ? await decryptContentAsync(cfg.api_key, file.content) : file.content;
  // drive_read cannot decrypt, so a private session's uploads are not offered.
  const uploads = encrypted ? undefined : { workspaceId: run.workspace_id, fileIds: run.artifacts_produced };
  process.stdout.write(`${buildHandoff(markdown, opts.maxChars, uploads)}\n`);
}
