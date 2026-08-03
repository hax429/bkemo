import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { BkemoNote } from '../types.js';
import { formatNoteTime, noteCardBody, noteListTitle, noteTags } from './noteList.js';

const note = (content: string, extra: Partial<BkemoNote> = {}): BkemoNote => ({
  portableId: '67b2d411-221e-4dbe-98a4-d6db7c98c793',
  revision: 1,
  type: 0,
  content,
  isArchived: false,
  dueDate: null,
  isImportant: false,
  isUrgent: false,
  completedAt: null,
  createdAt: '2026-08-01T08:00:00.000Z',
  updatedAt: '2026-08-01T08:10:00.000Z',
  ...extra,
});

describe('noteList helpers', () => {
  it('formats titles, card bodies, tags, and timestamps', () => {
    const sample = note('Write the report #work\n\n- outline\n- draft', {
      tags: [{ portableId: '11111111-1111-1111-1111-111111111111', name: 'work' }],
    });
    assert.equal(noteListTitle(sample), 'Write the report #work');
    assert.equal(noteCardBody(sample), 'Write the report #work\n\n- outline\n- draft');
    assert.deepEqual(noteTags(sample), ['work']);
    assert.match(formatNoteTime(sample.updatedAt), /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});
