import Dexie, { type Table } from 'dexie';
import type { Note } from '@shared/lib/types';

type CachedNote = Note & { id: number };

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
  }
}

const db = new NoteCacheDB();

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

export async function clearNoteCache(): Promise<void> {
  await db.notes.clear();
}
