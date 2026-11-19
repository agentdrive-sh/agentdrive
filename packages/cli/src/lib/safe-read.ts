import { constants, promises as fs, type Stats } from 'node:fs';

// Reads `real` (a path realpath already returned and the caller vetted) only if it is
// still that regular, single-link file. Between the vetting and the read it can be
// swapped for a link or a FIFO, or have a parent folder swapped for a link, so: lstat
// refuses links on every platform (Windows has no O_NOFOLLOW), the open handle must be
// the file lstat saw, O_NONBLOCK keeps a FIFO from blocking the open, the path must
// still resolve to itself after the read, and the size cap holds for what was read.
// A file with other hard links is skipped: one can carry, say, ~/.ssh/config.
export async function readVetted(real: string, maxBytes = Infinity): Promise<{ buf: Buffer; st: Stats } | null> {
  const seen = await fs.lstat(real).catch(() => null);
  if (!seen?.isFile() || seen.nlink !== 1 || seen.size > maxBytes) return null;
  const file = await fs.open(real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null);
  if (!file) return null;
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== seen.ino || opened.dev !== seen.dev || opened.size > maxBytes) return null;
    const buf = await file.readFile();
    const st = await file.stat();
    if (buf.length > maxBytes || st.nlink !== 1 || (await fs.realpath(real).catch(() => null)) !== real) return null;
    return { buf, st };
  } finally {
    await file.close();
  }
}
