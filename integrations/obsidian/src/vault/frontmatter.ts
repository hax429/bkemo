import type { BkemoNote } from '../types';

export function buildProjectionFrontmatter(note: BkemoNote, contentHash: string): Record<string, unknown> {
  return {
    bkemo: 1,
    portableId: note.portableId,
    revision: note.revision,
    source: note.source || '',
    type: note.type,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    dueDate: note.dueDate,
    completedAt: note.completedAt,
    isImportant: note.isImportant,
    isUrgent: note.isUrgent,
    isArchived: note.isArchived,
    tags: (note.tags || []).map((tag) => tag.name),
    contentHash,
  };
}

export function defaultProjectionPath(note: BkemoNote, root = 'bkemo'): string {
  const updated = new Date(note.updatedAt);
  const year = String(updated.getUTCFullYear());
  const month = String(updated.getUTCMonth() + 1).padStart(2, '0');
  const slug = (note.content.split('\n')[0] || 'note')
    .replace(/[#*[\]\\/:"<>|?]/g, '')
    .trim()
    .slice(0, 48)
    .replace(/\s+/g, '-')
    .toLowerCase() || 'note';
  const prefix = note.portableId.slice(0, 8);
  return `${root.replace(/\/+$/, '')}/${year}/${month}/${slug}--${prefix}.md`;
}
