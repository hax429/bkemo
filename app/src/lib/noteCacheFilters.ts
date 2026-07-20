import type { Note } from '@shared/lib/types';

export type Quadrant = 'do' | 'schedule' | 'delegate' | 'eliminate';

export type CacheFilter = {
  type?: number | null;
  isArchived?: boolean | null;
  isRecycle?: boolean | null;
  isTop?: boolean | null;
  hasParent?: boolean | null;
  tagId?: number | null;
  withoutTag?: boolean;
  withFile?: boolean;
  withLink?: boolean;
  searchText?: string;
  projectTag?: string;
  startDate?: Date | null;
  endDate?: Date | null;
  hasTodo?: boolean;
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

const QUADRANT_MAP: Record<Quadrant, { isImportant: boolean; isUrgent: boolean }> = {
  do: { isImportant: true, isUrgent: true },
  schedule: { isImportant: true, isUrgent: false },
  delegate: { isImportant: false, isUrgent: true },
  eliminate: { isImportant: false, isUrgent: false },
};

function tagPattern(tag: string) {
  return new RegExp(`#${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\b|/)`, 'i');
}

export function noteMatchesProject(note: Note, tag: string): boolean {
  const pattern = tagPattern(tag);
  if (pattern.test(note.content ?? '')) return true;
  if (((note as any).subtasks ?? []).some((child: Note) => pattern.test(child.content ?? ''))) return true;
  return pattern.test((note as any).parentNote?.content ?? '');
}

export function filterCachedNotes(input: Note[], filter: CacheFilter): Note[] {
  let notes = [...input];

  // `-1` is the API sentinel for all note types, never a persisted note type.
  if (filter.type != null && filter.type !== -1) {
    notes = notes.filter((note) => note.type === filter.type);
  }
  if (filter.isArchived != null) {
    notes = notes.filter((note) => !!note.isArchived === !!filter.isArchived);
  }
  if (filter.isRecycle != null) {
    notes = notes.filter((note) => !!note.isRecycle === !!filter.isRecycle);
  }
  if (filter.isTop != null) {
    notes = notes.filter((note) => !!note.isTop === !!filter.isTop);
  }
  if (filter.hasParent != null) {
    notes = notes.filter((note) => (note.parentNoteId != null) === filter.hasParent);
  }
  if (filter.tagId) {
    notes = notes.filter((note) => note.tags?.some((tag) => tag.id === filter.tagId));
  }
  if (filter.withoutTag) {
    notes = notes.filter((note) => !note.tags?.length);
  }
  if (filter.withFile) {
    notes = notes.filter((note) => note.attachments?.some((attachment) => !attachment.type?.startsWith('image/')));
  }
  if (filter.withLink) {
    notes = notes.filter((note) => /https?:\/\//.test(note.content ?? ''));
  }
  if (filter.searchText) {
    const query = filter.searchText.toLowerCase();
    notes = notes.filter((note) => note.content?.toLowerCase().includes(query));
  }
  if (filter.projectTag) {
    notes = notes.filter((note) => noteMatchesProject(note, filter.projectTag!));
  }
  if (filter.startDate) {
    notes = notes.filter((note) => note.createdAt && new Date(note.createdAt) >= filter.startDate!);
  }
  if (filter.endDate) {
    notes = notes.filter((note) => note.createdAt && new Date(note.createdAt) <= filter.endDate!);
  }
  if (filter.hasTodo) {
    notes = notes.filter((note) => /- \[[ x]\]/i.test(note.content ?? ''));
  }
  if (filter.isImportant != null) {
    notes = notes.filter((note) => !!note.isImportant === !!filter.isImportant);
  }
  if (filter.isUrgent != null) {
    notes = notes.filter((note) => !!note.isUrgent === !!filter.isUrgent);
  }
  if (filter.isCompleted != null) {
    notes = notes.filter((note) => (note.completedAt != null) === !!filter.isCompleted);
  }
  if (filter.quadrant) {
    const quadrant = QUADRANT_MAP[filter.quadrant];
    notes = notes.filter((note) => !!note.isImportant === quadrant.isImportant && !!note.isUrgent === quadrant.isUrgent);
  }
  if (filter.parentNoteId !== undefined) {
    notes = notes.filter((note) => (note.parentNoteId ?? null) === filter.parentNoteId);
  }
  if (filter.hasDueDate != null) {
    notes = notes.filter((note) => (note.dueDate != null) === !!filter.hasDueDate);
  }
  if (filter.dueStart) {
    notes = notes.filter((note) => note.dueDate && new Date(note.dueDate) >= filter.dueStart!);
  }
  if (filter.dueEnd) {
    notes = notes.filter((note) => note.dueDate && new Date(note.dueDate) <= filter.dueEnd!);
  }

  notes.sort((a, b) => {
    if (a.isTop && !b.isTop) return -1;
    if (!a.isTop && b.isTop) return 1;
    return new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime();
  });

  const start = (filter.page - 1) * filter.size;
  return notes.slice(start, start + filter.size);
}
