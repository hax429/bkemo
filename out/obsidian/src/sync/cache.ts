import type { BkemoNote } from '../types';

export type CacheSnapshot = {
  notesById: Record<string, BkemoNote>;
  recentIds: string[];
  changeCursor: number;
};

export function emptyCache(): CacheSnapshot {
  return { notesById: {}, recentIds: [], changeCursor: 0 };
}

export function upsertCachedNotes(cache: CacheSnapshot, notes: BkemoNote[], recentLimit = 50): CacheSnapshot {
  const notesById = { ...cache.notesById };
  for (const note of notes) notesById[note.portableId] = note;
  const recentIds = [
    ...notes.map((note) => note.portableId),
    ...cache.recentIds.filter((id) => !notes.some((note) => note.portableId === id)),
  ].slice(0, recentLimit);
  return { ...cache, notesById, recentIds };
}
