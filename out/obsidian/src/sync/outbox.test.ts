import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueueCapture,
  markCaptureFailure,
  outboxPendingCount,
  removeCapture,
  type OutboxCapture,
} from './outbox.js';

const typed = (id: string): OutboxCapture => ({
  kind: 'typed',
  id,
  content: 'hello',
  idempotencyKey: `key-${id}`,
  createdAt: '2026-08-03T00:00:00.000Z',
  attempts: 0,
});

describe('outbox helpers', () => {
  it('enqueues, marks failures, and removes captures', () => {
    let queue: OutboxCapture[] = [];
    queue = enqueueCapture(queue, typed('a'));
    queue = enqueueCapture(queue, typed('b'));
    assert.equal(outboxPendingCount(queue), 2);
    queue = markCaptureFailure(queue, 'a', 'offline');
    assert.equal(queue[0]?.attempts, 1);
    assert.equal(queue[0]?.lastError, 'offline');
    queue = removeCapture(queue, 'a');
    assert.deepEqual(queue.map((item) => item.id), ['b']);
  });
});
