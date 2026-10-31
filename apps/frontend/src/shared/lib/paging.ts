import { apiClient } from '../api/api-client.js';

/** Appends the entries of `more` that `list` does not have yet; order stays newest first. */
export function mergeById<T extends { id: string }>(list: T[], more: T[]): T[] {
  const ids = new Set(list.map((item) => item.id));
  return [...list, ...more.filter((item) => !ids.has(item.id))];
}

/**
 * Loads the page after the entries already shown. New entries shift the offset, so a page can
 * repeat a few known ones; merging by id drops them. `done` means nothing older is left.
 */
export async function loadOlder<T extends { id: string }>(
  path: string,
  loaded: T[],
  limit: number
): Promise<{ list: T[]; done: boolean }> {
  const page = await apiClient.get<T[]>(path, { params: { limit, offset: loaded.length } });
  return { list: mergeById(loaded, page), done: page.length < limit };
}
