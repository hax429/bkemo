import type { BkemoNote } from '../types';

export function noteListTitle(note: BkemoNote): string {
  const line = note.content.split('\n').find((value) => value.trim()) || 'Untitled';
  return line.replace(/^#+\s*/, '').slice(0, 100);
}

/** Full note body for card rendering, lightly capped for feed density. */
export function noteCardBody(note: BkemoNote, maxChars = 900): string {
  const content = note.content.trim();
  if (!content) return '_Empty note_';
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars).trimEnd()}\n\n…`;
}

export function noteExcerpt(note: BkemoNote, maxLines = 8): string {
  const lines = note.content
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, index, all) => !(index > 0 && !line && !all[index - 1]));
  const body = lines.join('\n').trim();
  if (!body) return 'Empty note';
  return body.split('\n').slice(0, maxLines).join('\n');
}

export function noteTags(note: BkemoNote): string[] {
  const fromMeta = (note.tags || []).map((tag) => tag.name).filter(Boolean);
  if (fromMeta.length) return [...new Set(fromMeta)].slice(0, 8);
  const matches = note.content.match(/(?<!:\/\/)(?<=\s|^)#[^\s#]+/g) || [];
  return [...new Set(matches.map((tag) => tag.slice(1)))].slice(0, 8);
}

export function formatNoteTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}:${ss}`;
}

export function isTaskNote(note: BkemoNote): boolean {
  return note.type === 2 || !!note.dueDate || !!note.completedAt;
}

export function cardAccent(note: BkemoNote): 'accent' | 'important' | 'urgent' | 'neutral' {
  if (note.isUrgent) return 'urgent';
  if (note.isImportant) return 'important';
  if (isTaskNote(note)) return 'accent';
  return 'neutral';
}
