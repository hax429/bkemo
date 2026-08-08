import type { BkemoClient } from '../types';
import type { CacheSnapshot } from './cache';
import { upsertCachedNotes } from './cache';

export type PullChangesResult = {
  cache: CacheSnapshot;
  hasMore: boolean;
};

export async function pullChanges(client: BkemoClient, cache: CacheSnapshot): Promise<PullChangesResult> {
  const batch = await client.readChanges(cache.changeCursor);
  const next = upsertCachedNotes(cache, batch.changed);
  const notesById = { ...next.notesById };
  for (const portableId of batch.removedPortableIds) delete notesById[portableId];
  return {
    cache: {
      ...next,
      notesById,
      recentIds: next.recentIds.filter((id) => !batch.removedPortableIds.includes(id)),
      changeCursor: batch.cursor,
    },
    hasMore: batch.hasMore,
  };
}

/** Advance the change cursor a few batches without unbounded polling. */
export async function pullChangesBounded(
  client: BkemoClient,
  cache: CacheSnapshot,
  maxBatches = 3,
): Promise<CacheSnapshot> {
  let current = cache;
  for (let i = 0; i < maxBatches; i++) {
    const { cache: next, hasMore } = await pullChanges(client, current);
    current = next;
    if (!hasMore) break;
  }
  return current;
}
