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
  onSecurity?: () => void;
  platformHeaders?: Record<string, string>;
  subscribeOnline?: (listener: () => void) => () => void;
  pollMs?: number;
  idleMs?: number;
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
 * Visible-client live sync. SSE remains connected while the client is online;
 * cursor polling is limited to recently active clients to avoid idle traffic.
 */
export function createNoteSyncController(options: NoteSyncControllerOptions): {
  dispose: () => void;
  syncNow: () => Promise<void>;
} {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pollMs = options.pollMs ?? 60_000;
  const idleMs = options.idleMs ?? 5 * 60_000;
  let stopped = false;
  let recentlyActive = true;
  let cursor = readCursor(options.accountId);
  let syncing: Promise<void> | null = null;
  let syncRequested = false;
  let streamAbort: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const canConnect = () => !stopped
    && options.isOnline()
    && (typeof document === 'undefined' || document.visibilityState === 'visible');

  const sync = () => {
    if (!canConnect()) return Promise.resolve();
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

  const stopPolling = () => {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  };

  const startPolling = () => {
    if (!canConnect() || !recentlyActive || pollTimer) return;
    pollTimer = setInterval(() => { void sync(); }, pollMs);
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer || !canConnect()) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void sync();
      void openStream();
    }, 2_000);
  };

  const openStream = async () => {
    if (!canConnect() || streamAbort) return;
    const abort = new AbortController();
    streamAbort = abort;
    try {
      const response = await fetchImpl(options.streamUrl, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${options.token}`,
          ...(options.platformHeaders ?? {}),
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
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? '';
        for (const event of events) {
          const lines = event.split(/\r?\n/);
          if (!lines.some(line => line.trim() === 'event: dirty')) continue;
          const raw = lines.find(line => line.startsWith('data:'))?.slice(5).trim();
          let kind: string | undefined;
          try { kind = raw ? JSON.parse(raw)?.kind : undefined; } catch { /* legacy event */ }
          if (kind === 'security') {
            options.onSecurity?.();
            continue;
          }
          if (!kind || kind === 'note') void sync();
        }
      }
    } catch (error) {
      if (!abort.signal.aborted) console.warn('[note-sync] SSE disconnected:', error);
    } finally {
      if (streamAbort === abort) streamAbort = null;
      scheduleReconnect();
    }
  };

  const resume = () => {
    if (!canConnect()) return;
    startPolling();
    void sync();
    void openStream();
  };
  const suspend = () => {
    stopPolling();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    streamAbort?.abort();
    streamAbort = null;
  };
  const markActivity = () => {
    if (stopped) return;
    const wasIdle = !recentlyActive;
    recentlyActive = true;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      recentlyActive = false;
      stopPolling();
    }, idleMs);
    if (wasIdle) resume();
    else startPolling();
  };
  const onVisibility = () => document.visibilityState === 'visible' ? resume() : suspend();
  const onOnline = () => resume();
  const onOffline = () => suspend();

  window.addEventListener('focus', resume);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('keydown', markActivity);
  window.addEventListener('pointerdown', markActivity);
  window.addEventListener('pointermove', markActivity);
  document.addEventListener('visibilitychange', onVisibility);
  const unsubscribeOnline = options.subscribeOnline?.(resume);
  markActivity();
  resume();

  return {
    dispose: () => {
      stopped = true;
      stopPolling();
      if (idleTimer) clearTimeout(idleTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      streamAbort?.abort();
      unsubscribeOnline?.();
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('keydown', markActivity);
      window.removeEventListener('pointerdown', markActivity);
      window.removeEventListener('pointermove', markActivity);
      document.removeEventListener('visibilitychange', onVisibility);
    },
    syncNow: () => sync(),
  };
}
