import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { UsageWarning } from './api-client.js';

// The latest plan-usage warning or pause a background sync saw, kept so the
// next SessionStart hook can show it without a network call. Cleared once a
// sync writes and gets no warning back.
const FILE = 'usage-notice.json';

export async function readUsageNotice(dir: string): Promise<UsageWarning | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(join(dir, FILE), 'utf8')) as Partial<UsageWarning>;
    return typeof parsed.message === 'string' && typeof parsed.level === 'string' ? (parsed as UsageWarning) : undefined;
  } catch {
    return undefined;
  }
}

export async function writeUsageNotice(dir: string, notice: UsageWarning | undefined): Promise<void> {
  if (!notice) return fs.rm(join(dir, FILE), { force: true });
  await fs.writeFile(join(dir, FILE), JSON.stringify(notice), { mode: 0o600 });
}
