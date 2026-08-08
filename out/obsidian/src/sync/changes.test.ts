import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { BkemoClient, BkemoNote, ChangeBatch } from '../types.js';
import { emptyCache } from './cache.js';
import { pullChanges, pullChangesBounded } from './changes.js';

const note = (portableId: string, content: string, revision = 1): BkemoNote => ({
  portableId,
  revision,
  type: 0,
  content,
  isArchived: false,
  dueDate: null,
  isImportant: false,
  isUrgent: false,
  completedAt: null,
  createdAt: '2026-08-01T08:00:00.000Z',
  updatedAt: '2026-08-01T08:10:00.000Z',
});

function fakeClient(batches: ChangeBatch[]): BkemoClient {
  let index = 0;
  return {
    search: async () => ({ notes: [], nextCursor: null }),
    getNote: async () => note('x', ''),
    createNote: async () => note('x', ''),
    updateNote: async () => note('x', ''),
    uploadAudio: async () => ({ portableId: 'a', name: 'a.webm', size: 1, type: 'audio/webm' }),
    getAttachment: async () => ({ portableId: 'a', name: 'a.webm', size: 1, type: 'audio/webm' }),
    getAttachmentContent: async () => new Blob(['x']),
    listTags: async () => [],
    getLinkEnrichment: async () => {
      throw { code: 'not_found', message: 'not found' };
    },
    readChanges: async () => {
      const batch = batches[Math.min(index, batches.length - 1)]!;
      index += 1;
      return batch;
    },
  };
}

describe('pullChanges', () => {
  it('merges changed notes, removes deleted ids, and advances the cursor', async () => {
    const cache = emptyCache();
    cache.notesById = {
      keep: note('keep', 'keep'),
      gone: note('gone', 'gone'),
    };
    cache.recentIds = ['gone', 'keep'];
    cache.changeCursor = 2;

    const { cache: next, hasMore } = await pullChanges(
      fakeClient([{
        cursor: 9,
        hasMore: false,
        changed: [note('keep', 'updated', 2), note('new', 'fresh')],
        removedPortableIds: ['gone'],
      }]),
      cache,
    );

    assert.equal(hasMore, false);
    assert.equal(next.changeCursor, 9);
    assert.equal(next.notesById.keep?.content, 'updated');
    assert.equal(next.notesById.new?.content, 'fresh');
    assert.equal(next.notesById.gone, undefined);
    assert.deepEqual(next.recentIds, ['keep', 'new']);
  });

  it('pullChangesBounded stops when hasMore is false or the batch cap is hit', async () => {
    const client = fakeClient([
      { cursor: 1, hasMore: true, changed: [note('a', 'a')], removedPortableIds: [] },
      { cursor: 2, hasMore: true, changed: [note('b', 'b')], removedPortableIds: [] },
      { cursor: 3, hasMore: true, changed: [note('c', 'c')], removedPortableIds: [] },
      { cursor: 4, hasMore: false, changed: [note('d', 'd')], removedPortableIds: [] },
    ]);
    const next = await pullChangesBounded(client, emptyCache(), 3);
    assert.equal(next.changeCursor, 3);
    assert.ok(next.notesById.a);
    assert.ok(next.notesById.b);
    assert.ok(next.notesById.c);
    assert.equal(next.notesById.d, undefined);
  });
});
