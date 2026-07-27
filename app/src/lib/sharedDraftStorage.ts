import { NoteType } from '@shared/lib/types';

const LEGACY_QUICKNOTE_KEY = 'bkemo.quicknoteDraft';
const CLIENT_ID_KEY = 'bkemo.sharedDraftClientId';

export type SharedDraftFields = {
  content: string;
  type: NoteType;
  isImportant: boolean;
  isUrgent: boolean;
  dueDate: string | null;
};

export type LocalSharedDraft = SharedDraftFields & {
  revision: number;
  updatedAt: string;
  pending: boolean;
};

export type DraftRecovery = {
  id: string;
  savedAt: string;
  draft: LocalSharedDraft;
};

export const emptySharedDraft = (): LocalSharedDraft => ({
  content: '',
  type: NoteType.BLINKO,
  isImportant: false,
  isUrgent: false,
  dueDate: null,
  revision: 0,
  updatedAt: new Date(0).toISOString(),
  pending: false,
});

const draftKey = (accountId: string | number) => `bkemo.sharedDraft:${accountId}`;
const recoveryKey = (accountId: string | number) => `bkemo.sharedDraftRecovery:${accountId}`;

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadLocalSharedDraft(accountId: string | number): LocalSharedDraft {
  const scoped = parse<LocalSharedDraft>(localStorage.getItem(draftKey(accountId)));
  if (scoped) return scoped;

  // One-time migration from the old, account-agnostic Quick Note key. Removing
  // it prevents a later account from seeing the previous account's text.
  const legacy = localStorage.getItem(LEGACY_QUICKNOTE_KEY);
  localStorage.removeItem(LEGACY_QUICKNOTE_KEY);
  if (!legacy) return emptySharedDraft();

  const migrated: LocalSharedDraft = {
    ...emptySharedDraft(),
    content: legacy,
    updatedAt: new Date().toISOString(),
    pending: true,
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

export function saveDraftRecovery(accountId: string | number, draft: LocalSharedDraft): DraftRecovery {
  const recovery: DraftRecovery = {
    id: globalThis.crypto?.randomUUID?.() ?? `recovery-${Date.now()}`,
    savedAt: new Date().toISOString(),
    draft: { ...draft, pending: true },
  };
  localStorage.setItem(recoveryKey(accountId), JSON.stringify(recovery));
  return recovery;
}

export function loadDraftRecovery(accountId: string | number): DraftRecovery | null {
  return parse<DraftRecovery>(localStorage.getItem(recoveryKey(accountId)));
}

export function clearDraftRecovery(accountId: string | number): void {
  localStorage.removeItem(recoveryKey(accountId));
}
