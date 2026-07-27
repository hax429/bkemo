import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/trpc';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';
import { extractNoteLinkIds } from '@/lib/noteLinks';
import {
  type DraftRecovery,
  type LocalSharedDraft,
  type SharedDraftFields,
  clearDraftRecovery,
  clearLocalSharedDraft,
  emptySharedDraft,
  getSharedDraftClientId,
  loadDraftRecovery,
  loadLocalSharedDraft,
  saveDraftRecovery,
  saveLocalSharedDraft,
} from '@/lib/sharedDraftStorage';

const LOCAL_EVENT = 'bkemo:shared-draft-local';
const AUTOSAVE_MS = 2_000;

type ServerDraft = LocalSharedDraft & {
  writerId: string | null;
  leaseExpiresAt: string | Date | null;
};

function fromServer(value: any): ServerDraft {
  return {
    content: value?.content ?? '',
    type: value?.type ?? 0,
    isImportant: !!value?.isImportant,
    isUrgent: !!value?.isUrgent,
    dueDate: value?.dueDate ? new Date(value.dueDate).toISOString() : null,
    revision: Number(value?.revision ?? 0),
    updatedAt: value?.updatedAt ? new Date(value.updatedAt).toISOString() : new Date(0).toISOString(),
    pending: false,
    writerId: value?.writerId ?? null,
    leaseExpiresAt: value?.leaseExpiresAt ?? null,
  };
}

function isLockedByAnother(draft: ServerDraft, clientId: string): boolean {
  if (!draft.writerId || draft.writerId === clientId || !draft.leaseExpiresAt) return false;
  return new Date(draft.leaseExpiresAt).getTime() > Date.now();
}

export function useSharedDraft(enabled = true) {
  const user = RootStore.Get(UserStore);
  const accountId = user.id;
  const token = user.token;
  const clientId = useMemo(() => getSharedDraftClientId(), []);
  const [draft, setDraftState] = useState<ServerDraft>(() => ({
    ...(accountId ? loadLocalSharedDraft(accountId) : emptySharedDraft()),
    writerId: null,
    leaseExpiresAt: null,
  }));
  const [recovery, setRecovery] = useState<DraftRecovery | null>(() => (
    accountId ? loadDraftRecovery(accountId) : null
  ));
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef(draft);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTail = useRef<Promise<ServerDraft>>(Promise.resolve(draft));
  const mutationInFlight = useRef(0);

  const apply = useCallback((next: ServerDraft, broadcast = false) => {
    draftRef.current = next;
    setDraftState(next);
    if (accountId) saveLocalSharedDraft(accountId, next);
    if (broadcast) {
      window.dispatchEvent(new CustomEvent(LOCAL_EVENT, {
        detail: { accountId: String(accountId), draft: next },
      }));
    }
  }, [accountId]);

  const preserveConflict = useCallback((local: ServerDraft, current: any) => {
    if (accountId && local.content.trim()) setRecovery(saveDraftRecovery(accountId, local));
    const server = current ? fromServer(current) : { ...emptySharedDraft(), writerId: null, leaseExpiresAt: null };
    apply(server, true);
    return server;
  }, [accountId, apply]);

  const claim = useCallback(async (force = false): Promise<ServerDraft> => {
    if (!enabled || !accountId || !token) return draftRef.current;
    const current = draftRef.current;
    const result: any = force
      ? await api.draft.takeover.mutate({ writerId: clientId, expectedRevision: current.revision })
      : await api.draft.claim.mutate({
        writerId: clientId,
        ...(current.revision > 0 ? { expectedRevision: current.revision } : {}),
      });
    if (!result.ok) return preserveConflict(current, result.conflict.current);
    const claimed = fromServer(result.draft);
    apply(claimed, true);
    return claimed;
  }, [enabled, accountId, token, clientId, apply, preserveConflict]);

  const saveSnapshot = useCallback(async (snapshot: ServerDraft): Promise<ServerDraft> => {
    if (!enabled || !accountId || !token) return snapshot;
    mutationInFlight.current += 1;
    setSyncing(true);
    setError(null);
    let owned = snapshot;
    try {
      if (owned.revision < 1 || owned.writerId !== clientId || isLockedByAnother(owned, clientId)) {
        owned = await claim(false);
      }
      if (owned.writerId !== clientId || owned.revision < 1) return owned;
      const result: any = await api.draft.save.mutate({
        writerId: clientId,
        expectedRevision: owned.revision,
        content: snapshot.content,
        type: snapshot.type,
        isImportant: snapshot.isImportant,
        isUrgent: snapshot.isUrgent,
        dueDate: snapshot.dueDate,
      });
      if (!result.ok) return preserveConflict(snapshot, result.conflict.current);
      const saved = fromServer(result.draft);
      const latest = draftRef.current;
      const changedSinceRequest = latest.updatedAt !== snapshot.updatedAt;
      const next = changedSinceRequest
        ? { ...latest, revision: saved.revision, writerId: saved.writerId, leaseExpiresAt: saved.leaseExpiresAt }
        : saved;
      apply(next, true);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return snapshot;
    } finally {
      mutationInFlight.current -= 1;
      setSyncing(false);
    }
  }, [enabled, accountId, token, clientId, claim, preserveConflict, apply]);

  const queueSave = useCallback((_snapshot: ServerDraft): Promise<ServerDraft> => {
    // Resolve the latest revision after any in-flight save, while preserving
    // edits that arrived during that request.
    saveTail.current = saveTail.current
      .catch(() => draftRef.current)
      .then(() => saveSnapshot(draftRef.current));
    return saveTail.current;
  }, [saveSnapshot]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void queueSave(draftRef.current);
    }, AUTOSAVE_MS);
  }, [queueSave]);

  const update = useCallback((patch: Partial<SharedDraftFields>) => {
    const next: ServerDraft = {
      ...draftRef.current,
      ...patch,
      updatedAt: new Date().toISOString(),
      pending: true,
    };
    apply(next, true);
    scheduleSave();
  }, [apply, scheduleSave]);

  const reload = useCallback(async () => {
    if (!enabled || !accountId || !token) return;
    if (mutationInFlight.current > 0) return;
    try {
      const current: any = await api.draft.get.query();
      const local = draftRef.current;
      if (!current) {
        if (local.content.trim() || local.pending) scheduleSave();
        return;
      }
      const server = fromServer(current);
      if (local.pending && local.revision !== server.revision) {
        preserveConflict(local, current);
      } else if (!local.pending || server.revision > local.revision) {
        apply(server, true);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [enabled, accountId, token, scheduleSave, preserveConflict, apply]);

  const finalize = useCallback(async (attachments: Array<{ name: string; path: string; size: string | number; type: string }> = []) => {
    if (!enabled || !accountId || !token) return null;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const saved = await queueSave(draftRef.current);
    if (saved.writerId !== clientId || saved.revision < 1 || saved.pending) return null;
    mutationInFlight.current += 1;
    setSyncing(true);
    try {
      const result: any = await api.draft.finalize.mutate({
        writerId: clientId,
        expectedRevision: saved.revision,
        referenceIds: extractNoteLinkIds(saved.content),
        attachments,
      });
      if (!result.ok) {
        preserveConflict(saved, result.conflict.current);
        return null;
      }
      const cleared: ServerDraft = { ...emptySharedDraft(), writerId: null, leaseExpiresAt: null };
      clearLocalSharedDraft(accountId);
      apply(cleared, true);
      return result.note;
    } finally {
      mutationInFlight.current -= 1;
      setSyncing(false);
    }
  }, [enabled, accountId, token, clientId, queueSave, preserveConflict, apply]);

  const takeOver = useCallback(() => claim(true), [claim]);
  const restoreRecovery = useCallback(() => {
    if (!recovery) return;
    update({
      content: recovery.draft.content,
      type: recovery.draft.type,
      isImportant: recovery.draft.isImportant,
      isUrgent: recovery.draft.isUrgent,
      dueDate: recovery.draft.dueDate,
    });
    if (accountId) clearDraftRecovery(accountId);
    setRecovery(null);
  }, [recovery, accountId, update]);
  const dismissRecovery = useCallback(() => {
    if (accountId) clearDraftRecovery(accountId);
    setRecovery(null);
  }, [accountId]);

  useEffect(() => {
    if (!enabled || !accountId) return;
    const local = loadLocalSharedDraft(accountId);
    apply({ ...local, writerId: null, leaseExpiresAt: null });
    setRecovery(loadDraftRecovery(accountId));
    void reload();
  // Account changes must replace the entire local draft.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, accountId]);

  useEffect(() => {
    const onLocal = (event: Event) => {
      const detail = (event as CustomEvent<{ accountId: string; draft: ServerDraft }>).detail;
      if (!detail || detail.accountId !== String(accountId)) return;
      const next = detail.draft;
      if (next && next !== draftRef.current) {
        draftRef.current = next;
        setDraftState(next);
      }
    };
    window.addEventListener(LOCAL_EVENT, onLocal);
    return () => window.removeEventListener(LOCAL_EVENT, onLocal);
  }, [accountId]);

  useEffect(() => {
    if (!enabled || !accountId || !token) return;
    let stopped = false;
    let abort: AbortController | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;

    const open = async () => {
      if (stopped || document.visibilityState !== 'visible') return;
      abort = new AbortController();
      try {
        const response = await fetch(getBlinkoEndpoint('/api/v1/note/events'), {
          headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: abort.signal,
        });
        if (!response.ok || !response.body) throw new Error(`SSE HTTP ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!stopped && !abort.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split(/\r?\n\r?\n/);
          buffer = events.pop() ?? '';
          for (const event of events) {
            const data = event.split(/\r?\n/).find((line) => line.startsWith('data:'))?.slice(5).trim();
            if (!data) continue;
            try {
              if (JSON.parse(data)?.kind === 'draft') void reload();
            } catch { /* ready events and malformed data are ignored */ }
          }
        }
      } catch (cause) {
        if (!abort?.signal.aborted) console.warn('[draft-sync] SSE disconnected:', cause);
      } finally {
        abort = null;
        if (!stopped) reconnect = setTimeout(() => { void open(); }, 2_000);
      }
    };
    const onFocus = () => { void reload(); void open(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    void open();
    return () => {
      stopped = true;
      abort?.abort();
      if (reconnect) clearTimeout(reconnect);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
    };
  }, [enabled, accountId, token, reload]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  return {
    draft,
    update,
    claim: () => claim(false),
    takeOver,
    finalize,
    locked: isLockedByAnother(draft, clientId),
    syncing,
    error,
    recovery,
    restoreRecovery,
    dismissRecovery,
  };
}
