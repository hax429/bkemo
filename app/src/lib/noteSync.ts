import type { Note } from '@shared/lib/types';

export type NoteSyncPayload = {
  cursor: number;
  changed: Note[];
  removedIds: number[];
};

export async function applyNoteSyncPayload(
  payload: NoteSyncPayload,
  actions: {
    cache: (notes: Note[]) => Promise<unknown>;
    remove: (ids: number[]) => Promise<unknown>;
    invalidate: () => void;
  },
): Promise<boolean> {
  const changed = payload.changed.length > 0 || payload.removedIds.length > 0;
  if (!changed) return false;
  if (payload.changed.length > 0) await actions.cache(payload.changed);
  if (payload.removedIds.length > 0) await actions.remove(payload.removedIds);
  actions.invalidate();
  return true;
}

type NoteSyncControllerOptions = {
  accountId: string;
  token: string;
  streamUrl: string;
  fetchChanges: (input: { cursor?: number; bootstrap?: boolean }) => Promise<NoteSyncPayload>;
  apply: (payload: NoteSyncPayload) => Promise<unknown>;
  isOnline: () => boolean;
  onBootstrap: () => void;
  subscribeOnline?: (listener: () => void) => () => void;
  pollMs?: number;
  fetchImpl?: typeof fetch;
};

const cursorKey = (accountId: string) => `bkemo_note_sync_cursor:${accountId}`;

function readCursor(accountId: string): number | undefined {
  try {
    const raw = localStorage.getItem(cursorKey(accountId));
    if (raw == null) return undefined;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function writeCursor(accountId: string, cursor: number) {
  try { localStorage.setItem(cursorKey(accountId), String(cursor)); } catch { /* ignore */ }
}

/**
 * Foreground-only live sync. SSE is the fast signal; the durable cursor poll is
 * authoritative and catches disconnects, server restarts, and suspended apps.
 */
export function createNoteSyncController(options: NoteSyncControllerOptions): () => void {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pollMs = options.pollMs ?? 10_000;
  let stopped = false;
  let cursor = readCursor(options.accountId);
  let syncing: Promise<void> | null = null;
  let syncRequested = false;
  let streamAbort: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const canRun = () => !stopped
    && options.isOnline()
    && (typeof document === 'undefined' || document.visibilityState === 'visible');

  const sync = () => {
    if (!canRun()) return Promise.resolve();
    if (syncing) {
      syncRequested = true;
      return syncing;
    }
    syncing = (async () => {
      const bootstrap = cursor == null;
      const payload = await options.fetchChanges({
        ...(cursor == null ? {} : { cursor }),
        ...(bootstrap ? { bootstrap: true } : {}),
      });
      if (bootstrap) options.onBootstrap();
      await options.apply(payload);
      cursor = payload.cursor;
      writeCursor(options.accountId, payload.cursor);
    })().catch((error) => {
      console.warn('[note-sync] reconciliation failed:', error);
    }).finally(() => {
      syncing = null;
      if (syncRequested) {
        syncRequested = false;
        queueMicrotask(() => { void sync(); });
      }
    });
    return syncing;
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer || !canRun()) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void openStream();
    }, 2_000);
  };

  const openStream = async () => {
    if (!canRun() || streamAbort) return;
    const abort = new AbortController();
    streamAbort = abort;
    try {
      const response = await fetchImpl(options.streamUrl, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${options.token}`,
        },
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
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        if (lines.some(line => line.startsWith('data:'))) void sync();
      }
    } catch (error) {
      if (!abort.signal.aborted) console.warn('[note-sync] SSE disconnected:', error);
    } finally {
      if (streamAbort === abort) streamAbort = null;
      scheduleReconnect();
    }
  };

  const resume = () => {
    if (!canRun()) return;
    void sync();
    void openStream();
  };
  const suspend = () => {
    streamAbort?.abort();
    streamAbort = null;
  };
  const onVisibility = () => document.visibilityState === 'visible' ? resume() : suspend();
  const onOnline = () => resume();

  const poll = setInterval(() => { void sync(); }, pollMs);
  window.addEventListener('focus', resume);
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisibility);
  const unsubscribeOnline = options.subscribeOnline?.(resume);
  resume();

  return () => {
    stopped = true;
    clearInterval(poll);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    streamAbort?.abort();
    unsubscribeOnline?.();
    window.removeEventListener('focus', resume);
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
