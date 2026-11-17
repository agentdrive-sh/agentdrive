import { constants, promises as fs } from 'node:fs';
import { dirname } from 'node:path';

export type WriteAction = 'created' | 'updated' | 'unchanged';

export async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

// Throws on unparseable content so a merge never replaces a file it could not
// read (JSONC with comments, a half-written file) with only our keys.
export async function readJsonObject(path: string): Promise<Record<string, unknown> | null> {
  const raw = await readTextIfExists(path);
  if (raw === null) return null;
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${path} is not plain JSON; left untouched`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object; left untouched`);
  }
  return parsed as Record<string, unknown>;
}

export async function writeFileIfChanged(
  path: string,
  content: string,
  opts: { backup?: boolean } = {},
): Promise<WriteAction> {
  const current = await readTextIfExists(path);
  if (current === content) return 'unchanged';
  await fs.mkdir(dirname(path), { recursive: true });
  if (current !== null && opts.backup) {
    // The first .bak is the user's pre-AgentDrive original; later runs must not overwrite it.
    // 0600 because an original Codex config.toml can hold the API key init just removed.
    try {
      await fs.copyFile(path, `${path}.bak`, constants.COPYFILE_EXCL);
      await fs.chmod(`${path}.bak`, 0o600);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  await fs.writeFile(path, content, 'utf8');
  return current === null ? 'created' : 'updated';
}

export async function writeJsonIfChanged(path: string, value: unknown): Promise<WriteAction> {
  return writeFileIfChanged(path, `${JSON.stringify(value, null, 2)}\n`, { backup: true });
}
