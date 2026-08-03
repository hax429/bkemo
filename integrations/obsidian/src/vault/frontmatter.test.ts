import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectionFrontmatter, defaultProjectionPath } from './frontmatter.js';
import type { BkemoNote } from '../types.js';

const note: BkemoNote = {
  portableId: '67b2d411-221e-4dbe-98a4-d6db7c98c793',
  revision: 42,
  type: 2,
  content: 'Write the report #work',
  isArchived: false,
  dueDate: null,
  isImportant: false,
  isUrgent: true,
  completedAt: null,
  createdAt: '2026-08-01T08:00:00.000Z',
  updatedAt: '2026-08-01T08:10:00.000Z',
  source: 'https://bk.hax429.me/note/67b2d411-221e-4dbe-98a4-d6db7c98c793',
  tags: [{ portableId: '11111111-1111-1111-1111-111111111111', name: 'work' }],
};

describe('projection frontmatter', () => {
  it('keeps portable identity and task metadata', () => {
    const fm = buildProjectionFrontmatter(note, 'sha256:abc');
    assert.equal(fm.bkemo, 1);
    assert.equal(fm.portableId, note.portableId);
    assert.equal(fm.revision, 42);
    assert.deepEqual(fm.tags, ['work']);
    assert.equal(fm.contentHash, 'sha256:abc');
  });

  it('builds a deterministic path under the vault root', () => {
    assert.equal(
      defaultProjectionPath(note, 'bkemo'),
      'bkemo/2026/08/write-the-report-work--67b2d411.md',
    );
  });
});
