import type { PagedResponse } from './api-client';

// Small metadata lists (versions, comments, shares) must follow their cursors.
// A broken cursor must fail visibly rather than hang or silently omit records.
export async function collectPages<T>(read: (cursor?: string) => Promise<PagedResponse<T>>): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 1_000; page++) {
    const result = await read(cursor);
    items.push(...result.items);
    if (!result.cursor) return items;
    if (seen.has(result.cursor)) throw new Error('The server repeated a page. Please retry.');
    seen.add(result.cursor);
    cursor = result.cursor;
  }
  throw new Error('This list is too large to load at once. Please narrow the request.');
}
