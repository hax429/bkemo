import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/trpc';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';
import { extractNoteLinkIds } from '@/lib/noteLinks';
import { isInTauri } from '@/lib/tauriHelper';
import {
  type LocalSharedDraft,
  type SharedDraftFields,
  clearDismissedServerUpdatedAt,
  clearLegacyDraftArtifacts,
  clearLocalSharedDraft,
  emptySharedDraft,
  loadDismissedServerUpdatedAt,
  loadLocalSharedDraft,
  saveDismissedServerUpdatedAt,
  saveLocalSharedDraft,
} from '@/lib/sharedDraftStorage';

const LOCAL_EVENT = 'bkemo:shared-draft-local';
const FLUSH_EVENT = 'draft-flush-before-quit';

type RecoverableDraft = LocalSharedDraft & { id: number };

type FlushPayload = SharedDraftFields & { updatedAt: string };

let latestFlush: {
  accountId: number;
  token: string;
  draft: FlushPayload;
} | null = null;

function fieldsFrom(draft: LocalSharedDraft): SharedDraftFields {
  return {
    content: draft.content,
    type: draft.type,
    isImportant: draft.isImportant,
    isUrgent: draft.isUrgent,
    dueDate: draft.dueDate,
  };
}

function fromServer(value: any): RecoverableDraft {
  return {
    id: Number(value.id),
    content: value?.content ?? '',
    type: value?.type ?? 0,
    isImportant: !!value?.isImportant,
    isUrgent: !!value?.isUrgent,
    dueDate: value?.dueDate ? new Date(value.dueDate).toISOString() : null,
    updatedAt: value?.updatedAt ? new Date(value.updatedAt).toISOString() : new Date(0).toISOString(),
  };
}

async function postSnapshotKeepalive(accountId: number, token: string, draft: FlushPayload) {
  const url = getBlinkoEndpoint('/api/trpc/draft.snapshot');
  const body = JSON.stringify({
    json: {
      content: draft.content,
      type: draft.type,
      isImportant: draft.isImportant,
      isUrgent: draft.isUrgent,
      dueDate: draft.dueDate,
    },
  });
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body,
      keepalive: true,
      cache: 'no-store',
    });
  } catch (error) {
    console.warn('[draft] close snapshot failed', accountId, error);
  }
}

function flushLatestDraft() {
  const current = latestFlush;
  if (!current) return;
  void postSnapshotKeepalive(current.accountId, current.token, current.draft);
}

export function useSharedDraft(enabled = true) {
  const user = RootStore.Get(UserStore);
  const accountId = user.id;
  const token = user.token;
  const [draft, setDraftState] = useState<LocalSharedDraft>(() => (
    accountId ? loadLocalSharedDraft(accountId) : emptySharedDraft()
  ));
  const [recoverable, setRecoverable] = useState<RecoverableDraft | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef(draft);

  const publishFlushTarget = useCallback((next: LocalSharedDraft) => {
    if (!enabled || !accountId || !token) {
      latestFlush = null;
      return;
    }
    latestFlush = { accountId, token, draft: { ...fieldsFrom(next), updatedAt: next.updatedAt } };
  }, [enabled, accountId, token]);

  const apply = useCallback((next: LocalSharedDraft, broadcast = false) => {
    draftRef.current = next;
    setDraftState(next);
    if (accountId) saveLocalSharedDraft(accountId, next);
    publishFlushTarget(next);
    if (broadcast) {
      window.dispatchEvent(new CustomEvent(LOCAL_EVENT, {
        detail: { accountId: String(accountId), draft: next },
      }));
    }
  }, [accountId, publishFlushTarget]);

  const update = useCallback((patch: Partial<SharedDraftFields>) => {
    const next: LocalSharedDraft = {
      ...draftRef.current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    apply(next, true);
  }, [apply]);

  const checkRecoverable = useCallback(async () => {
    if (!enabled || !accountId || !token) return;
    try {
      const current: any = await api.draft.get.query();
      if (!current || !String(current.content ?? '').trim()) {
        setRecoverable(null);
        return;
      }
      const server = fromServer(current);
      const local = draftRef.current;
      if (local.content === server.content) {
        setRecoverable(null);
        return;
      }
      const dismissed = loadDismissedServerUpdatedAt(accountId);
      if (dismissed && dismissed === server.updatedAt) {
        setRecoverable(null);
        return;
      }
      setRecoverable(server);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [enabled, accountId, token]);

  const finalize = useCallback(async (attachments: Array<{ name: string; path: string; size: string | number; type: string }> = []) => {
    if (!enabled || !accountId || !token) return null;
    const snapshot = draftRef.current;
    if (!snapshot.content.trim() && attachments.length === 0) return null;
    setSyncing(true);
    setError(null);
    try {
      const result: any = await api.draft.finalize.mutate({
        ...fieldsFrom(snapshot),
        referenceIds: extractNoteLinkIds(snapshot.content),
        attachments,
      });
      const cleared = emptySharedDraft();
      clearLocalSharedDraft(accountId);
      clearDismissedServerUpdatedAt(accountId);
      apply(cleared, true);
      setRecoverable(null);
      latestFlush = null;
      return result.note;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally {
      setSyncing(false);
    }
  }, [enabled, accountId, token, apply]);

  const restoreRecoverable = useCallback(() => {
    if (!recoverable) return;
    apply({
      content: recoverable.content,
      type: recoverable.type,
      isImportant: recoverable.isImportant,
      isUrgent: recoverable.isUrgent,
      dueDate: recoverable.dueDate,
      updatedAt: new Date().toISOString(),
    }, true);
    if (accountId) clearDismissedServerUpdatedAt(accountId);
    setRecoverable(null);
  }, [recoverable, accountId, apply]);

  const dismissRecoverable = useCallback(() => {
    if (!recoverable || !accountId) {
      setRecoverable(null);
      return;
    }
    saveDismissedServerUpdatedAt(accountId, recoverable.updatedAt);
    setRecoverable(null);
    void api.draft.clear.mutate().catch(() => undefined);
  }, [recoverable, accountId]);

  useEffect(() => {
    if (!enabled || !accountId) return;
    clearLegacyDraftArtifacts(accountId);
    const local = loadLocalSharedDraft(accountId);
    apply(local);
    void checkRecoverable();
  // Account changes must replace the entire local draft.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, accountId]);

  useEffect(() => {
    publishFlushTarget(draftRef.current);
  }, [publishFlushTarget, accountId, token]);

  useEffect(() => {
    const onLocal = (event: Event) => {
      const detail = (event as CustomEvent<{ accountId: string; draft: LocalSharedDraft }>).detail;
      if (!detail || detail.accountId !== String(accountId)) return;
      if (detail.draft && detail.draft !== draftRef.current) {
        draftRef.current = detail.draft;
        setDraftState(detail.draft);
        publishFlushTarget(detail.draft);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (!accountId || event.key !== `bkemo.sharedDraft:${accountId}` || !event.newValue) return;
      try {
        const next = JSON.parse(event.newValue) as LocalSharedDraft;
        if (next.updatedAt === draftRef.current.updatedAt && next.content === draftRef.current.content) return;
        draftRef.current = next;
        setDraftState(next);
        publishFlushTarget(next);
      } catch { /* ignore corrupt payloads */ }
    };
    window.addEventListener(LOCAL_EVENT, onLocal);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(LOCAL_EVENT, onLocal);
      window.removeEventListener('storage', onStorage);
    };
  }, [accountId, publishFlushTarget]);

  useEffect(() => {
    if (!enabled) return;
    const onPageHide = () => flushLatestDraft();
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !isInTauri()) return;
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/event').then(({ listen }) => (
      listen(FLUSH_EVENT, () => { flushLatestDraft(); })
    )).then((fn) => { unlisten = fn; }).catch(() => undefined);
    return () => { unlisten?.(); };
  }, [enabled]);

  return {
    draft,
    update,
    finalize,
    syncing,
    error,
    recoverable,
    restoreRecoverable,
    dismissRecoverable,
  };
}
