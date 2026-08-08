import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { BkemoNote } from '../types.js';
import { createTestRoot, queryCard } from '../test/dom.js';
import { renderAttachmentFilenames, renderMemoCard } from './noteCard.js';

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

describe('noteCard UI', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders accessible card chrome, tags, and badges', () => {
    const root = createTestRoot();
    const sample = note('Ship UI tests #work\n\nDetails', {
      type: 2,
      isImportant: true,
      tags: [{ portableId: '11111111-1111-1111-1111-111111111111', name: 'work' }],
    });

    renderMemoCard(root, { note: sample, selected: true });

    const card = queryCard(root, sample.portableId);
    assert.ok(card);
    assert.equal(card?.getAttribute('role'), 'button');
    assert.ok(card?.classList.contains('is-active'));
    assert.ok(card?.classList.contains('is-important'));
    assert.equal(card?.querySelector('.bkemo-badge.is-task')?.textContent, 'task');
    assert.equal(card?.querySelector('.bkemo-badge.is-important')?.textContent, 'important');
    assert.equal(card?.querySelector('.bkemo-tag')?.textContent, '#work');
    assert.match(card?.querySelector('.bkemo-memo-plain')?.textContent || '', /Ship UI tests/);
  });

  it('fires select and edit callbacks from card interactions', () => {
    const root = createTestRoot();
    const sample = note('Hello');
    let selected = 0;
    let edited = 0;

    const card = renderMemoCard(root, {
      note: sample,
      onSelect: () => {
        selected += 1;
      },
      onEdit: () => {
        edited += 1;
      },
    });

    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    assert.equal(selected, 1);
    assert.equal(edited, 1);

    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(selected, 2);
  });

  it('renders attachment open/copy controls', () => {
    const root = createTestRoot();
    let opened = '';
    let copied = '';
    renderAttachmentFilenames(
      root,
      [{ portableId: 'a1', name: 'clip.webm', size: 2048, type: 'audio/webm' }],
      {
        formatTitle: () => 'audio/webm · 2.0 KB',
        onOpen: (attachment) => {
          opened = attachment.name;
        },
        onCopy: (attachment) => {
          copied = attachment.name;
        },
      },
    );

    const openBtn = root.querySelector('button.bkemo-attachment-file') as HTMLButtonElement | null;
    const copyBtn = root.querySelector('button.bkemo-attachment-copy') as HTMLButtonElement | null;
    assert.ok(openBtn);
    assert.ok(copyBtn);
    openBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    copyBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    assert.equal(opened, 'clip.webm');
    assert.equal(copied, 'clip.webm');
  });
});
