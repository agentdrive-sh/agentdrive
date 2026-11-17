import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { codexHome } from '@adrive/mcp-server/transcripts/paths';
import { trustCodexHooks, type CodexTrustResult } from './codex-trust.js';
import { detectInstalledAgents, wireAgent } from './detect-agents.js';
import {
  CLAUDE_MANUAL_STEPS,
  CODEX_TRUST_NOTE,
  HARNESS_LABELS,
  HOOK_HARNESSES,
  harnessInstalled,
  installClaudePlugin,
  removeLegacyClaudeSkill,
  wireHarness,
  type ClaudePluginResult,
} from './harness-wiring.js';

export interface WireOutcome {
  id: string;
  label: string;
  status: 'wired' | 'manual' | 'failed' | 'absent';
  changed: string[];
  removed?: string[];
  warnings: string[];
  detail?: string;
}

export interface WireDeps {
  installClaude?: (stdio: 'inherit' | 'ignore') => ClaudePluginResult;
  trustCodex?: (codexHome: string) => Promise<CodexTrustResult>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export async function installedToolIds(home: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  const ids: string[] = [];
  if (await dirExists(join(home, '.claude'))) ids.push('claude-code');
  for (const h of HOOK_HARNESSES) if (await harnessInstalled(h, home, env)) ids.push(h);
  for (const t of await detectInstalledAgents({ home, env })) ids.push(t.name);
  return ids;
}

// Wires every installed agent tool whose id passes `include`. init passes everything;
// the session-start auto-wire passes only tools it has never wired before.
export async function wireInstalled(
  home: string,
  env: NodeJS.ProcessEnv,
  opts: { include?: (id: string) => boolean; quiet?: boolean; deps?: WireDeps } = {},
): Promise<WireOutcome[]> {
  const include = opts.include ?? (() => true);
  const out: WireOutcome[] = [];

  if (include('claude-code')) {
    const o: WireOutcome = { id: 'claude-code', label: 'Claude Code', status: 'absent', changed: [], warnings: [] };
    if (await dirExists(join(home, '.claude'))) {
      const result = (opts.deps?.installClaude ?? installClaudePlugin)(opts.quiet ? 'ignore' : 'inherit');
      if (result.status === 'installed') {
        o.status = 'wired';
        o.detail = 'plugin agentdrive@agentdrive';
        // Until the plugin is in, the old skill is the only AgentDrive integration Claude Code has.
        try {
          const legacy = await removeLegacyClaudeSkill(home);
          if (legacy) o.removed = [`${legacy} (old CLI copy; the plugin ships the skill now)`];
        } catch (err) {
          o.warnings.push(`could not remove the old AgentDrive skill: ${errorMessage(err)}`);
        }
      } else {
        o.status = 'manual';
        o.detail = result.status === 'no-claude' ? '`claude` not on PATH' : result.detail;
        o.warnings.push(`in Claude Code, run: ${CLAUDE_MANUAL_STEPS.join(' then ')}`);
      }
    }
    out.push(o);
  }

  for (const h of HOOK_HARNESSES) {
    if (!include(h)) continue;
    const o: WireOutcome = { id: h, label: HARNESS_LABELS[h], status: 'absent', changed: [], warnings: [] };
    out.push(o);
    if (!(await harnessInstalled(h, home, env))) continue;
    try {
      const wiring = await wireHarness(h, home, env);
      o.changed.push(...wiring.changed);
      o.warnings.push(...wiring.warnings);
      if (h === 'codex') {
        const trust = await (opts.deps?.trustCodex ?? trustCodexHooks)(codexHome(env, home));
        if (trust.status === 'unavailable') o.warnings.push(`${CODEX_TRUST_NOTE} (automatic approval failed: ${trust.detail})`);
      }
      o.status = o.warnings.length ? 'manual' : 'wired';
    } catch (err) {
      o.status = 'failed';
      o.detail = errorMessage(err);
    }
  }

  for (const t of await detectInstalledAgents({ home, env })) {
    if (!include(t.name)) continue;
    const o: WireOutcome = { id: t.name, label: t.name, status: 'wired', changed: [], warnings: [], detail: 'MCP' };
    try {
      if ((await wireAgent(t)) !== 'unchanged') o.changed.push(t.configPath);
    } catch (err) {
      o.status = 'failed';
      o.detail = errorMessage(err);
    }
    out.push(o);
  }
  return out;
}
