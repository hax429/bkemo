import Dexie, { type Table } from 'dexie';
import type { Note } from '@shared/lib/types';

type CachedNote = Note & { id: number };

export type Quadrant = 'do' | 'schedule' | 'delegate' | 'eliminate';

type CacheFilter = {
  type?: number | null;
  isArchived?: boolean | null;
  isRecycle?: boolean | null;
  tagId?: number | null;
  withoutTag?: boolean;
  withFile?: boolean;
  withLink?: boolean;
  searchText?: string;
  startDate?: Date | null;
  endDate?: Date | null;
  hasTodo?: boolean;
  // Task filters. Lane date-ranges resolve to dueStart/dueEnd on the caller side.
  dueStart?: Date | null;
  dueEnd?: Date | null;
  hasDueDate?: boolean | null;
  isImportant?: boolean | null;
  isUrgent?: boolean | null;
  isCompleted?: boolean | null;
  quadrant?: Quadrant | null;
  parentNoteId?: number | null;
  page: number;
  size: number;
};

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

const QUADRANT_MAP: Record<Quadrant, { isImportant: boolean; isUrgent: boolean }> = {
  do: { isImportant: true, isUrgent: true },
  schedule: { isImportant: true, isUrgent: false },
  delegate: { isImportant: false, isUrgent: true },
  eliminate: { isImportant: false, isUrgent: false },
};

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

export async function queryNotesFromCache(filter: CacheFilter): Promise<Note[]> {
  let notes = await db.notes.toArray();

  // type: 0 is a valid value (BLINKO), so check explicitly
  if (filter.type != null) {
    notes = notes.filter(n => n.type === filter.type);
  }
  if (filter.isArchived != null) {
    notes = notes.filter(n => !!n.isArchived === !!filter.isArchived);
  }
  if (filter.isRecycle != null) {
    notes = notes.filter(n => !!n.isRecycle === !!filter.isRecycle);
  }
  if (filter.tagId) {
    notes = notes.filter(n => n.tags?.some(t => t.id === filter.tagId));
  }
  if (filter.withoutTag) {
    notes = notes.filter(n => !n.tags?.length);
  }
  if (filter.withFile) {
    notes = notes.filter(n => n.attachments?.some(a => !a.type?.startsWith('image/')));
  }
  if (filter.withLink) {
    notes = notes.filter(n => /https?:\/\//.test(n.content ?? ''));
  }
  if (filter.searchText) {
    const q = filter.searchText.toLowerCase();
    notes = notes.filter(n => n.content?.toLowerCase().includes(q));
  }
  if (filter.startDate) {
    notes = notes.filter(n => n.createdAt && new Date(n.createdAt) >= filter.startDate!);
  }
  if (filter.endDate) {
    notes = notes.filter(n => n.createdAt && new Date(n.createdAt) <= filter.endDate!);
  }
  if (filter.hasTodo) {
    notes = notes.filter(n => /- \[[ x]\]/i.test(n.content ?? ''));
  }
  // ── Task filters ──
  if (filter.isImportant != null) {
    notes = notes.filter(n => !!n.isImportant === !!filter.isImportant);
  }
  if (filter.isUrgent != null) {
    notes = notes.filter(n => !!n.isUrgent === !!filter.isUrgent);
  }
  if (filter.isCompleted != null) {
    notes = notes.filter(n => (n.completedAt != null) === !!filter.isCompleted);
  }
  if (filter.quadrant) {
    const q = QUADRANT_MAP[filter.quadrant];
    notes = notes.filter(n => !!n.isImportant === q.isImportant && !!n.isUrgent === q.isUrgent);
  }
  if (filter.parentNoteId !== undefined) {
    notes = notes.filter(n => (n.parentNoteId ?? null) === filter.parentNoteId);
  }
  if (filter.hasDueDate != null) {
    notes = notes.filter(n => (n.dueDate != null) === !!filter.hasDueDate);
  }
  if (filter.dueStart) {
    notes = notes.filter(n => n.dueDate && new Date(n.dueDate) >= filter.dueStart!);
  }
  if (filter.dueEnd) {
    notes = notes.filter(n => n.dueDate && new Date(n.dueDate) <= filter.dueEnd!);
  }

  // pinned first, then newest first
  notes.sort((a, b) => {
    if (a.isTop && !b.isTop) return -1;
    if (!a.isTop && b.isTop) return 1;
    return new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime();
  });

  const start = (filter.page - 1) * filter.size;
  return notes.slice(start, start + filter.size);
}

export async function patchNoteInCache(id: number, patch: Partial<Note>): Promise<void> {
  const existing = await db.notes.get(id);
  if (existing) await db.notes.put({ ...existing, ...patch, id });
}

export async function deleteNoteFromCache(id: number): Promise<void> {
  await db.notes.delete(id);
}
