import type { Prisma, PrismaClient } from '@prisma/client';

export const NOTE_CHANGE_PAGE_SIZE = 500;
export const NOTE_CHANGE_PAGE_SIZE_MAX = 1000;

type ChangeRow = {
  id: number;
  noteId: number;
  operation: string;
};

type NoteSyncPrisma = Pick<PrismaClient, 'noteChange' | 'notes'>;

const noteSnapshotInclude = {
  tags: { include: { tag: true } },
  attachments: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  references: { select: { toNoteId: true } },
  referencedBy: { select: { fromNoteId: true } },
  parentNote: { select: { id: true, content: true } },
  subtasks: {
    orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
    include: {
      tags: { include: { tag: true } },
      attachments: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      _count: { select: { comments: true, histories: true, reactions: true } },
    },
  },
  _count: { select: { comments: true, histories: true, reactions: true } },
} satisfies Prisma.notesInclude;

/**
 * Read one stable cursor page and resolve each touched ID to its current state.
 * The journal is account-filtered before cursoring; snapshots are independently
 * account-filtered so an ID can never disclose another account's note.
 */
export async function readNoteChanges(
  db: NoteSyncPrisma,
  accountId: number,
  cursor: number,
  requestedLimit = NOTE_CHANGE_PAGE_SIZE,
) {
  const limit = Math.min(Math.max(requestedLimit, 1), NOTE_CHANGE_PAGE_SIZE_MAX);
  const fetched = await db.noteChange.findMany({
    where: { accountId, id: { gt: cursor } },
    orderBy: { id: 'asc' },
    take: limit + 1,
    select: { id: true, noteId: true, operation: true },
  }) as ChangeRow[];
  const hasMore = fetched.length > limit;
  const page = hasMore ? fetched.slice(0, limit) : fetched;
  const nextCursor = page.at(-1)?.id ?? cursor;
  const noteIds = [...new Set(page.map((change) => change.noteId))];

  if (noteIds.length === 0) {
    return { cursor: nextCursor, hasMore, snapshots: [], removedIds: [] };
  }

  const current = await db.notes.findMany({
    where: { accountId, id: { in: noteIds } },
    include: noteSnapshotInclude,
  });
  const snapshots = current.filter((note) => !note.isRecycle);
  const activeIds = new Set(snapshots.map((note) => note.id));
  const removedIds = noteIds.filter((id) => !activeIds.has(id));

  return { cursor: nextCursor, hasMore, snapshots, removedIds };
}

export async function latestNoteChangeCursor(
  db: Pick<PrismaClient, 'noteChange'>,
  accountId: number,
): Promise<number> {
  const latest = await db.noteChange.findFirst({
    where: { accountId },
    orderBy: { id: 'desc' },
    select: { id: true },
  });
  return latest?.id ?? 0;
}

export type NoteDirtyListener = () => void;

/** Process-local wake-up channel. The PostgreSQL journal remains authoritative. */
export class NoteSyncHub {
  private listeners = new Map<number, Set<NoteDirtyListener>>();

  subscribe(accountId: number, listener: NoteDirtyListener): () => void {
    const accountListeners = this.listeners.get(accountId) ?? new Set();
    accountListeners.add(listener);
    this.listeners.set(accountId, accountListeners);

    return () => {
      accountListeners.delete(listener);
      if (accountListeners.size === 0) this.listeners.delete(accountId);
    };
  }

  publish(accountId: number): void {
    for (const listener of this.listeners.get(accountId) ?? []) listener();
  }

  listenerCount(accountId: number): number {
    return this.listeners.get(accountId)?.size ?? 0;
  }
}

export const noteSyncHub = new NoteSyncHub();

export function publishNoteDirty(accountId: number | string | null | undefined): void {
  const normalized = Number(accountId);
  if (Number.isInteger(normalized) && normalized > 0) noteSyncHub.publish(normalized);
}
