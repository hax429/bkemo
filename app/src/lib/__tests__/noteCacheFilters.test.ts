import { describe, expect, it } from 'vitest';
import { filterCachedNotes, noteMatchesProject } from '@/lib/noteCacheFilters';
import type { Note } from '@shared/lib/types';

const notes: Note[] = [
  { id: 1, type: 0, content: 'Parent #work', parentNoteId: null, isArchived: false, isRecycle: false, updatedAt: new Date('2026-01-03'), subtasks: [{ id: 3, type: 2, content: 'Child #release', parentNoteId: 1 }] } as Note,
  { id: 2, type: 2, content: 'Other parent', parentNoteId: null, isArchived: false, isRecycle: false, updatedAt: new Date('2026-01-02') } as Note,
  { id: 3, type: 2, content: 'Child #release', parentNoteId: 1, parentNote: { id: 1, content: 'Parent #work' }, isTop: true, isArchived: false, isRecycle: false, updatedAt: new Date('2026-01-04') } as Note,
  { id: 4, type: -1 as any, content: 'Legacy invalid type', parentNoteId: null, isArchived: false, isRecycle: false, updatedAt: new Date('2026-01-01') } as Note,
];

const base = { page: 1, size: 100, isArchived: false, isRecycle: false };

describe('filterCachedNotes', () => {
  it('treats type -1 as all types instead of a literal persisted type', () => {
    expect(filterCachedNotes(notes, { ...base, type: -1 }).map((note) => note.id)).toEqual([3, 1, 2, 4]);
  });

  it('returns top-level notes separately from pinned subtasks', () => {
    expect(filterCachedNotes(notes, { ...base, type: -1, parentNoteId: null }).map((note) => note.id)).toEqual([1, 2, 4]);
    expect(filterCachedNotes(notes, { ...base, type: -1, hasParent: true, isTop: true }).map((note) => note.id)).toEqual([3]);
  });

  it('includes a parent project card when one of its subtasks has the tag', () => {
    expect(noteMatchesProject(notes[0]!, 'release')).toBe(true);
    expect(filterCachedNotes(notes, { ...base, type: -1, parentNoteId: null, projectTag: 'release' }).map((note) => note.id)).toEqual([1]);
  });
});
