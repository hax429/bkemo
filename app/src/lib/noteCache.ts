import Dexie, { type Table } from 'dexie';
import type { Note } from '@shared/lib/types';
import { filterCachedNotes, type CacheFilter } from './noteCacheFilters';
export type { Quadrant } from './noteCacheFilters';

type CachedNote = Note & { id: number };


class NoteCacheDB extends Dexie {
  notes!: Table<CachedNote, number>;

  constructor() {
    super('blinko_note_cache');
    this.version(1).stores({
      // id = primary key; remaining are indexes for future compound queries
      notes: 'id, type, isArchived, isRecycle, updatedAt',
    });
    // v2 adds task-field indexes for lane/matrix queries.
    this.version(2).stores({
      notes: 'id, type, isArchived, isRecycle, updatedAt, dueDate, completedAt',
    });
  }
}

const db = new NoteCacheDB();

/**
 * The note cache is a single IndexedDB shared by the browser, but notes are
 * per-account. When the signed-in account changes (logout, a different user
 * logging in on the same browser, or admin "view as"), the previous account's
 * notes must not leak into the new session. We remember which account owns the
 * current cache and wipe it on a mismatch.
 */
const CACHE_OWNER_KEY = 'blinko_note_cache_account';

export async function clearNoteCache(): Promise<void> {
  try { await db.notes.clear(); } catch (e) { console.error('[cache] clear failed:', e); }
}

/**
 * Ensure the local note cache belongs to `accountId`; if it was last written by
 * a different account, drop it. Cheap (a localStorage compare) so it's safe to
 * call on every query. An empty/unknown accountId is ignored (don't wipe during
 * the brief window before the token resolves).
 */
export async function ensureCacheAccount(accountId: string | number | null | undefined): Promise<boolean> {
  const id = accountId == null ? '' : String(accountId);
  if (!id) return false;
  let prev: string | null = null;
  try { prev = localStorage.getItem(CACHE_OWNER_KEY); } catch { /* ignore */ }
  if (prev !== id) {
    await clearNoteCache();
    try { localStorage.setItem(CACHE_OWNER_KEY, id); } catch { /* ignore */ }
    // A null prev is the first run on a fresh browser, not an account switch.
    return prev != null;
  }
  return false;
}

export async function upsertNotesToCache(notes: Note[]): Promise<void> {
  const valid = notes.filter((n): n is CachedNote => n.id != null);
  if (valid.length) await db.notes.bulkPut(valid);
}

/** Replace a fully fetched query scope, removing cached rows that no longer match server state. */
export async function replaceNotesInCache(filter: CacheFilter, notes: Note[]): Promise<void> {
  const rows = await db.notes.toArray();
  const cachedInScope = filterCachedNotes(rows, { ...filter, page: 1, size: Number.MAX_SAFE_INTEGER });
  const freshIds = new Set(notes.flatMap((note) => note.id == null ? [] : [note.id]));
  const staleIds = cachedInScope.flatMap((note) => note.id != null && !freshIds.has(note.id) ? [note.id] : []);
  await db.transaction('rw', db.notes, async () => {
    if (staleIds.length > 0) await db.notes.bulkDelete(staleIds);
    const valid = notes.filter((note): note is CachedNote => note.id != null);
    if (valid.length > 0) await db.notes.bulkPut(valid);
  });
}

export async function queryNotesFromCache(filter: CacheFilter): Promise<Note[]> {
  return filterCachedNotes(await db.notes.toArray(), filter);
}

export async function getNoteFromCache(id: number): Promise<Note | undefined> {
  return db.notes.get(id);
}

export async function patchNoteInCache(id: number, patch: Partial<Note>): Promise<void> {
  const existing = await db.notes.get(id);
  if (existing) await db.notes.put({ ...existing, ...patch, id });
}

export async function patchNoteTreeInCache(rootIds: number[], patch: Partial<Note>): Promise<void> {
  const rows = await db.notes.toArray();
  const treeIds = new Set(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (row.parentNoteId != null && treeIds.has(row.parentNoteId) && !treeIds.has(row.id)) {
        treeIds.add(row.id);
        changed = true;
      }
      if (treeIds.has(row.id)) {
        for (const child of (((row as any).subtasks ?? []) as Note[])) {
          if (child.id != null && !treeIds.has(child.id)) {
            treeIds.add(child.id);
            changed = true;
          }
        }
      }
    }
  }

  await db.notes.bulkPut(rows.map((row) => ({
    ...row,
    ...(treeIds.has(row.id) ? patch : {}),
    ...((row as any).subtasks ? {
      subtasks: ((row as any).subtasks as Note[]).map((child) => child.id != null && treeIds.has(child.id) ? { ...child, ...patch } : child),
    } : {}),
  })));
}

export async function deleteNoteFromCache(id: number): Promise<void> {
  await db.notes.delete(id);
}

export async function deleteNotesFromCache(ids: number[]): Promise<void> {
  if (ids.length > 0) await db.notes.bulkDelete(ids);
}
