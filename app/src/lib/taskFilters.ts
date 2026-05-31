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

/** A memo is a task if it's typed TODO or carries any task attribute. */
export function isTask(n: Note): boolean {
  return (
    n.type === NoteType.TODO ||
    n.dueDate != null ||
    !!n.isImportant ||
    !!n.isUrgent ||
    n.completedAt != null
  );
}

export function isDone(n: Note): boolean {
  return n.completedAt != null;
}

/** Bucket open tasks into Eisenhower quadrants (mirrors prototype BKEMO_QUADRANTS). */
export function bucketQuadrants(notes: Note[]): Record<Quadrant, Note[]> {
  const open = notes.filter(n => isTask(n) && !isDone(n));
  return {
    do: open.filter(t => t.isImportant && t.isUrgent),
    schedule: open.filter(t => t.isImportant && !t.isUrgent),
    delegate: open.filter(t => !t.isImportant && t.isUrgent),
    eliminate: open.filter(t => !t.isImportant && !t.isUrgent),
  };
}
