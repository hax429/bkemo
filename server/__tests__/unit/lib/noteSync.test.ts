import { describe, expect, test } from 'bun:test';
import { readFile } from 'fs/promises';
import path from 'path';
import { latestNoteChangeCursor, NoteSyncHub, readNoteChanges } from '../../../lib/noteSync';

type JournalRow = { id: number; accountId: number; noteId: number; operation: 'upsert' | 'delete' };
type NoteRow = { id: number; accountId: number; content: string; isRecycle?: boolean };

function fakeDb(journal: JournalRow[], notes: NoteRow[]) {
  return {
    noteChange: {
      findFirst: async ({ where }: any) =>
        journal
          .filter((row) => row.accountId === where.accountId)
          .sort((a, b) => b.id - a.id)[0] ?? null,
      findMany: async ({ where, take }: any) =>
        journal
          .filter((row) => row.accountId === where.accountId && row.id > where.id.gt)
          .sort((a, b) => a.id - b.id)
          .slice(0, take)
          .map(({ id, noteId, operation }) => ({ id, noteId, operation })),
    },
    notes: {
      findMany: async ({ where }: any) =>
        notes.filter((note) => note.accountId === where.accountId && where.id.in.includes(note.id)),
    },
  } as any;
}

describe('note change cursor', () => {
  test('advances in journal order and reports another page', async () => {
    const db = fakeDb(
      [
        { id: 7, accountId: 1, noteId: 10, operation: 'upsert' },
        { id: 8, accountId: 1, noteId: 11, operation: 'upsert' },
        { id: 9, accountId: 1, noteId: 12, operation: 'delete' },
      ],
      [
        { id: 10, accountId: 1, content: 'a' },
        { id: 11, accountId: 1, content: 'b' },
      ],
    );

    const result = await readNoteChanges(db, 1, 6, 2);

    expect(result.cursor).toBe(8);
    expect(result.hasMore).toBe(true);
    expect(result.snapshots.map((note: NoteRow) => note.id)).toEqual([10, 11]);
    expect(result.removedIds).toEqual([]);
  });

  test('isolates both journal rows and snapshots by account', async () => {
    const db = fakeDb(
      [
        { id: 1, accountId: 1, noteId: 20, operation: 'upsert' },
        { id: 2, accountId: 2, noteId: 21, operation: 'upsert' },
      ],
      [
        { id: 20, accountId: 1, content: 'mine' },
        { id: 21, accountId: 2, content: 'theirs' },
      ],
    );

    const result = await readNoteChanges(db, 1, 0);

    expect(result.cursor).toBe(1);
    expect(result.snapshots).toEqual([{ id: 20, accountId: 1, content: 'mine' }]);
    expect(result.removedIds).toEqual([]);
  });

  test('returns trashed and hard-deleted IDs as removals', async () => {
    const db = fakeDb(
      [
        { id: 1, accountId: 1, noteId: 30, operation: 'upsert' }, // create
        { id: 2, accountId: 1, noteId: 30, operation: 'upsert' }, // update
        { id: 3, accountId: 1, noteId: 30, operation: 'upsert' }, // trash
        { id: 4, accountId: 1, noteId: 31, operation: 'delete' }, // hard delete
      ],
      [{ id: 30, accountId: 1, content: 'edited', isRecycle: true }],
    );

    const result = await readNoteChanges(db, 1, 0);

    expect(result.cursor).toBe(4);
    expect(result.snapshots).toEqual([]);
    expect(result.removedIds).toEqual([30, 31]);
  });

  test('bootstraps at the account latest cursor without replaying its history', async () => {
    const db = fakeDb(
      [
        { id: 8, accountId: 1, noteId: 30, operation: 'upsert' },
        { id: 11, accountId: 1, noteId: 31, operation: 'upsert' },
        { id: 12, accountId: 2, noteId: 99, operation: 'upsert' },
      ],
      [],
    );

    expect(await latestNoteChangeCursor(db, 1)).toBe(11);
  });
});

describe('note journal migration', () => {
  test('captures insert, update, and delete with transactional trigger semantics', async () => {
    const migration = await readFile(
      path.resolve(import.meta.dir, '../../../../prisma/migrations/20260723000000_add_note_change_journal/migration.sql'),
      'utf8',
    );

    expect(migration).toContain('AFTER INSERT OR UPDATE OR DELETE ON "notes"');
    expect(migration).toContain("journal_operation := 'delete'");
    expect(migration).toContain("journal_operation := 'upsert'");
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('INSERT INTO "noteChange"');
  });
});

describe('note sync hub', () => {
  test('publishes only to the matching account and unsubscribes cleanly', () => {
    const hub = new NoteSyncHub();
    let accountOneSignals = 0;
    let accountTwoSignals = 0;
    const unsubscribe = hub.subscribe(1, () => accountOneSignals++);
    hub.subscribe(2, () => accountTwoSignals++);

    hub.publish(1);
    expect(accountOneSignals).toBe(1);
    expect(accountTwoSignals).toBe(0);
    expect(hub.listenerCount(1)).toBe(1);

    unsubscribe();
    hub.publish(1);
    expect(accountOneSignals).toBe(1);
    expect(hub.listenerCount(1)).toBe(0);
  });
});
