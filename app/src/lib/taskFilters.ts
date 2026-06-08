import dayjs from '@/lib/dayjs';
import type { Dayjs } from 'dayjs';
import type { Note } from '@shared/lib/types';
import { NoteType } from '@shared/lib/types';
import type { Quadrant } from '@/lib/noteCache';

export type TaskLane = 'inbox' | 'today' | 'tomorrow' | 'week';

export type DueRange = { dueStart?: Date | null; dueEnd?: Date | null; hasDueDate?: boolean | null };

/**
 * Resolve a todo lane to a concrete due-date range in the *caller's* timezone.
 * - today / tomorrow: that calendar day [00:00, 23:59:59].
 * - week: now → end of the 7th day ahead.
 * - inbox: tasks with no due date (hasDueDate=false). The "open" vs "done"
 *   split is applied separately via isCompleted.
 */
export function laneToDueRange(lane: TaskLane, now: Dayjs = dayjs()): DueRange {
  switch (lane) {
    case 'today':
      return { dueStart: now.startOf('day').toDate(), dueEnd: now.endOf('day').toDate() };
    case 'tomorrow': {
      const t = now.add(1, 'day');
      return { dueStart: t.startOf('day').toDate(), dueEnd: t.endOf('day').toDate() };
    }
    case 'week':
      return { dueStart: now.startOf('day').toDate(), dueEnd: now.add(7, 'day').endOf('day').toDate() };
    case 'inbox':
    default:
      return { hasDueDate: false };
  }
}

/**
 * A memo is a task if it's typed TODO, has a due date, or has been completed.
 * Priority flags (important/urgent) are *not* task markers — a plain memo can be
 * flagged important/urgent and show the indicator without becoming a to-do.
 */
export function isTask(n: Note): boolean {
  return (
    n.type === NoteType.TODO ||
    n.dueDate != null ||
    n.completedAt != null
  );
}

export function isDone(n: Note): boolean {
  return n.completedAt != null;
}

/**
 * Urgent for the matrix = explicitly flagged urgent, OR due today / overdue.
 * Applies to any memo/note/subtask, not just typed to-dos.
 */
export function isUrgentNote(n: Note, now: Dayjs = dayjs()): boolean {
  if (n.isUrgent) return true;
  if (n.dueDate == null) return false;
  return dayjs(n.dueDate).startOf('day').valueOf() <= now.startOf('day').valueOf();
}

/** Important for the matrix = the important flag (the `#important` tag maps to it on save). */
export function isImportantNote(n: Note): boolean {
  return !!n.isImportant;
}

/**
 * Bucket into Eisenhower quadrants. Includes open to-dos plus any memo/subtask
 * carrying a priority signal (important, urgent, or due today); plain memos with
 * no signal are left out. Urgent counts due-today/overdue, not just the flag.
 */
export function bucketQuadrants(notes: Note[], now: Dayjs = dayjs()): Record<Quadrant, Note[]> {
  const open = notes.filter(n => !isDone(n) && (isTask(n) || isImportantNote(n) || isUrgentNote(n, now)));
  const important = (t: Note) => isImportantNote(t);
  const urgent = (t: Note) => isUrgentNote(t, now);
  return {
    do: open.filter(t => important(t) && urgent(t)),
    schedule: open.filter(t => important(t) && !urgent(t)),
    delegate: open.filter(t => !important(t) && urgent(t)),
    eliminate: open.filter(t => !important(t) && !urgent(t)),
  };
}
