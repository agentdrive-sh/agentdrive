import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { readConfig, writeConfig } from './config.js';
import { installedToolIds, wireInstalled, type WireDeps } from './wire-all.js';

const NOTICE_FILE = 'autowired.json';

export interface AutoWireOptions {
  configDir: string;
  home: string;
  env: NodeJS.ProcessEnv;
  log: (msg: string) => Promise<void>;
  // The harness whose hook started this sync is evidently connected already.
  connected?: string;
  deps?: WireDeps;
}

// Runs inside the sync lock on session start, so two harnesses starting at once never wire concurrently.
export async function autoWire(opts: AutoWireOptions): Promise<string[]> {
  const path = join(opts.configDir, 'config.json');
  const cfg = await readConfig(path);
  if (!cfg?.api_key || cfg.preferences?.auto_wire === false) return [];

  // A config from before auto-wire has no record of what the user kept or removed, so the
  // tools installed today become the baseline and only tools installed later get wired.
  if (!cfg.wired) {
    await recordWired(path, [...(await installedToolIds(opts.home, opts.env)), ...(opts.connected ? [opts.connected] : [])]);
    return [];
  }
  const wired = new Set(cfg.wired);
  if (opts.connected) wired.add(opts.connected);

  const outcomes = await wireInstalled(opts.home, opts.env, { include: (id) => !wired.has(id), quiet: true, deps: opts.deps });
  const fresh = outcomes.filter((o) => o.status === 'wired' || o.status === 'manual');
  for (const o of fresh) wired.add(o.id);
  for (const o of outcomes.filter((o) => o.status === 'failed')) await opts.log(`auto-wire ${o.label} failed: ${o.detail}`);
  if (wired.size > cfg.wired.length) await recordWired(path, [...wired]);

  const announced = fresh.filter((o) => o.id === 'claude-code' || o.changed.length > 0 || o.warnings.length > 0);
  for (const o of announced) await opts.log(`auto-wired ${o.label}${o.warnings.length ? `; manual step: ${o.warnings.join('; ')}` : ''}`);
  if (announced.length) await appendNotice(opts.configDir, announced.map((o) => (o.warnings.length ? `${o.label} (${o.warnings.join('; ')})` : o.label)));
  return announced.map((o) => o.label);
}

// Re-reads so wiring never resurrects a config that `adrive auth logout` deleted meanwhile.
async function recordWired(path: string, ids: string[]): Promise<void> {
  const latest = await readConfig(path);
  if (!latest?.api_key) return;
  await writeConfig({ ...latest, wired: [...new Set([...(latest.wired ?? []), ...ids])] }, path);
}

async function appendNotice(dir: string, labels: string[]): Promise<void> {
  const path = join(dir, NOTICE_FILE);
  const prev = await readNotice(dir);
  await fs.writeFile(path, JSON.stringify([...new Set([...prev, ...labels])]), { mode: 0o600 });
}

async function readNotice(dir: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(join(dir, NOTICE_FILE), 'utf8')) as unknown;
    return Array.isArray(parsed) ? parsed.filter((l): l is string => typeof l === 'string') : [];
  } catch {
    return [];
  }
}

// The start hook shows the notice once; a separate file keeps it clear of config.json writes.
export async function takeAutoWireNotice(dir: string): Promise<string | undefined> {
  const labels = await readNotice(dir);
  if (!labels.length) return undefined;
  await fs.rm(join(dir, NOTICE_FILE), { force: true });
  return `AgentDrive connected newly installed agent tools: ${labels.join(', ')}. (Turn off with \`adrive privacy --auto-wire off\`.)`;
}
