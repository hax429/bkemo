import { NoteType } from '@shared/lib/types';

const LEGACY_QUICKNOTE_KEY = 'bkemo.quicknoteDraft';
const CLIENT_ID_KEY = 'bkemo.sharedDraftClientId';
const DISMISSED_KEY_PREFIX = 'bkemo.sharedDraftDismissed:';

export type SharedDraftFields = {
  content: string;
  type: NoteType;
  isImportant: boolean;
  isUrgent: boolean;
  dueDate: string | null;
};

export type LocalSharedDraft = SharedDraftFields & {
  updatedAt: string;
};

export const emptySharedDraft = (): LocalSharedDraft => ({
  content: '',
  type: NoteType.BLINKO,
  isImportant: false,
  isUrgent: false,
  dueDate: null,
  updatedAt: new Date(0).toISOString(),
});

const draftKey = (accountId: string | number) => `bkemo.sharedDraft:${accountId}`;
const dismissedKey = (accountId: string | number) => `${DISMISSED_KEY_PREFIX}${accountId}`;

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadLocalSharedDraft(accountId: string | number): LocalSharedDraft {
  const scoped = parse<LocalSharedDraft & { revision?: number; pending?: boolean }>(
    localStorage.getItem(draftKey(accountId)),
  );
  if (scoped) {
    return {
      content: scoped.content ?? '',
      type: scoped.type ?? NoteType.BLINKO,
      isImportant: !!scoped.isImportant,
      isUrgent: !!scoped.isUrgent,
      dueDate: scoped.dueDate ?? null,
      updatedAt: scoped.updatedAt ?? new Date(0).toISOString(),
    };
  }

  // One-time migration from the old, account-agnostic Quick Note key.
  const legacy = localStorage.getItem(LEGACY_QUICKNOTE_KEY);
  localStorage.removeItem(LEGACY_QUICKNOTE_KEY);
  if (!legacy) return emptySharedDraft();

  const migrated: LocalSharedDraft = {
    ...emptySharedDraft(),
    content: legacy,
    updatedAt: new Date().toISOString(),
  };
  saveLocalSharedDraft(accountId, migrated);
  return migrated;
}

export function saveLocalSharedDraft(accountId: string | number, draft: LocalSharedDraft): void {
  localStorage.setItem(draftKey(accountId), JSON.stringify(draft));
}

export function clearLocalSharedDraft(accountId: string | number): void {
  localStorage.removeItem(draftKey(accountId));
}

export function getSharedDraftClientId(): string {
  const existing = localStorage.getItem(CLIENT_ID_KEY);
  if (existing) return existing;
  const id = globalThis.crypto?.randomUUID?.() ?? `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(CLIENT_ID_KEY, id);
  return id;
}

/** Remember a dismissed server snapshot so it is not offered again until it changes. */
export function loadDismissedServerUpdatedAt(accountId: string | number): string | null {
  return localStorage.getItem(dismissedKey(accountId));
}

export function saveDismissedServerUpdatedAt(accountId: string | number, updatedAt: string): void {
  localStorage.setItem(dismissedKey(accountId), updatedAt);
}

export function clearDismissedServerUpdatedAt(accountId: string | number): void {
  localStorage.removeItem(dismissedKey(accountId));
}

/** Remove leftover keys from the previous live-sync draft implementation. */
export function clearLegacyDraftArtifacts(accountId: string | number): void {
  localStorage.removeItem(`bkemo.sharedDraftRecovery:${accountId}`);
}
