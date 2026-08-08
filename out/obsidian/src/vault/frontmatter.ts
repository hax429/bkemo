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
  return `${normalizeVaultRoot(root)}/${year}/${month}/${slug}--${prefix}.md`;
}

export function normalizeVaultRoot(root: string): string {
  return (root || 'bkemo').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || 'bkemo';
}

/** Reject path traversal and writes outside the configured projection root. */
export function assertPathUnderRoot(path: string, root: string): string {
  const rootNorm = normalizeVaultRoot(root);
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.split('/').includes('..')) {
    throw new Error('Invalid projection path');
  }
  if (normalized !== rootNorm && !normalized.startsWith(`${rootNorm}/`)) {
    throw new Error('Projection path escapes vault root');
  }
  return normalized;
}

export function serializeFrontmatter(fm: Record<string, unknown>): string {
  return Object.entries(fm).map(([key, value]) => {
    if (value === null || value === undefined) return `${key}: null`;
    if (typeof value === 'boolean' || typeof value === 'number') return `${key}: ${value}`;
    if (Array.isArray(value)) {
      return `${key}: [${value.map((item) => JSON.stringify(String(item))).join(', ')}]`;
    }
    return `${key}: ${JSON.stringify(String(value))}`;
  }).join('\n');
}

export function wrapProjectionMarkdown(fm: Record<string, unknown>, body: string): string {
  const trimmed = body.replace(/^\uFEFF/, '').replace(/^\n+/, '').replace(/\s+$/, '');
  return `---\n${serializeFrontmatter(fm)}\n---\n\n${trimmed}\n`;
}

export function stripFrontmatter(raw: string): string {
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) return raw;
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!match) return raw;
  return raw.slice(match[0].length).replace(/^\r?\n/, '');
}
