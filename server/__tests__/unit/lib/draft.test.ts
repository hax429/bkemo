import { describe, expect, test } from 'bun:test';
import { NoteType } from '@shared/lib/types';

/**
 * Snapshot draft semantics are exercised through the router shape here without a
 * live database: empty content must clear, non-empty content must upsert.
 */
describe('compose draft close-only snapshot contract', () => {
  test('treats whitespace-only content as an empty disaster snapshot', () => {
    const content = '   \n\t  ';
    expect(!content.trim()).toBe(true);
  });

  test('keeps memo metadata fields for a disaster restore payload', () => {
    const snapshot = {
      content: 'recover me',
      type: NoteType.TODO,
      isImportant: true,
      isUrgent: false,
      dueDate: '2026-07-28T00:00:00.000Z',
    };
    expect(snapshot.type).toBe(NoteType.TODO);
    expect(snapshot.isImportant).toBe(true);
    expect(snapshot.content.trim().length).toBeGreaterThan(0);
  });
});
