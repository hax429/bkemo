import { beforeEach, describe, expect, test } from 'vitest';
import { NoteType } from '@shared/lib/types';
import {
  clearLegacyDraftArtifacts,
  clearLocalSharedDraft,
  emptySharedDraft,
  loadDismissedServerUpdatedAt,
  loadLocalSharedDraft,
  saveDismissedServerUpdatedAt,
  saveLocalSharedDraft,
} from '@/lib/sharedDraftStorage';

describe('shared draft local storage', () => {
  beforeEach(() => localStorage.clear());

  test('migrates and removes the old account-agnostic quicknote key', () => {
    localStorage.setItem('bkemo.quicknoteDraft', 'private draft');

    const draft = loadLocalSharedDraft('42');

    expect(draft.content).toBe('private draft');
    expect(localStorage.getItem('bkemo.quicknoteDraft')).toBeNull();
    expect(loadLocalSharedDraft('42').content).toBe('private draft');
    expect(loadLocalSharedDraft('7').content).toBe('');
  });

  test('stores drafts independently per account', () => {
    saveLocalSharedDraft('1', {
      ...emptySharedDraft(),
      content: 'first',
      type: NoteType.TODO,
    });
    saveLocalSharedDraft('2', {
      ...emptySharedDraft(),
      content: 'second',
    });

    expect(loadLocalSharedDraft('1').content).toBe('first');
    expect(loadLocalSharedDraft('2').content).toBe('second');
    clearLocalSharedDraft('1');
    expect(loadLocalSharedDraft('1').content).toBe('');
  });

  test('tracks dismissed server snapshots and clears legacy recovery keys', () => {
    localStorage.setItem('bkemo.sharedDraftRecovery:42', '{"id":"x"}');
    saveDismissedServerUpdatedAt('42', '2026-07-27T00:00:00.000Z');

    expect(loadDismissedServerUpdatedAt('42')).toBe('2026-07-27T00:00:00.000Z');
    clearLegacyDraftArtifacts('42');
    expect(localStorage.getItem('bkemo.sharedDraftRecovery:42')).toBeNull();
  });
});
