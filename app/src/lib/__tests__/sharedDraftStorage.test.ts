import { beforeEach, describe, expect, test } from 'vitest';
import { NoteType } from '@shared/lib/types';
import {
  clearDraftRecovery,
  clearLocalSharedDraft,
  emptySharedDraft,
  loadDraftRecovery,
  loadLocalSharedDraft,
  saveDraftRecovery,
  saveLocalSharedDraft,
} from '@/lib/sharedDraftStorage';

describe('shared draft local storage', () => {
  beforeEach(() => localStorage.clear());

  test('migrates and removes the old account-agnostic quicknote key', () => {
    localStorage.setItem('bkemo.quicknoteDraft', 'private draft');

    const draft = loadLocalSharedDraft('42');

    expect(draft.content).toBe('private draft');
    expect(draft.pending).toBe(true);
    expect(localStorage.getItem('bkemo.quicknoteDraft')).toBeNull();
    expect(loadLocalSharedDraft('42').content).toBe('private draft');
    expect(loadLocalSharedDraft('7').content).toBe('');
  });

  test('stores drafts independently per account', () => {
    saveLocalSharedDraft('1', {
      ...emptySharedDraft(),
      content: 'first',
      type: NoteType.TODO,
      pending: true,
    });
    saveLocalSharedDraft('2', {
      ...emptySharedDraft(),
      content: 'second',
      pending: true,
    });

    expect(loadLocalSharedDraft('1').content).toBe('first');
    expect(loadLocalSharedDraft('2').content).toBe('second');
    clearLocalSharedDraft('1');
    expect(loadLocalSharedDraft('1').content).toBe('');
  });

  test('preserves and clears an offline conflict recovery copy', () => {
    const recovery = saveDraftRecovery('42', {
      ...emptySharedDraft(),
      content: 'offline version',
      pending: true,
    });

    expect(loadDraftRecovery('42')).toEqual(recovery);
    clearDraftRecovery('42');
    expect(loadDraftRecovery('42')).toBeNull();
  });
});
