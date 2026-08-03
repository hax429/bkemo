import type { BkemoClient } from '../types';
import type { CacheSnapshot } from './cache';
import { upsertCachedNotes } from './cache';

export async function pullChanges(client: BkemoClient, cache: CacheSnapshot): Promise<CacheSnapshot> {
  const batch = await client.readChanges(cache.changeCursor);
  const next = upsertCachedNotes(cache, batch.changed);
  const notesById = { ...next.notesById };
  for (const portableId of batch.removedPortableIds) delete notesById[portableId];
  return {
    ...next,
    notesById,
    recentIds: next.recentIds.filter((id) => !batch.removedPortableIds.includes(id)),
    changeCursor: batch.cursor,
  };
}
