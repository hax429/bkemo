/**
 * Native local notifications for due tasks (macOS / iOS / Android via Tauri).
 * See MOBILE_CLIENT_DESIGN.md §4.
 *
 * A TODO with a future `dueDate` schedules an OS-level local notification at the
 * due time (fires even when the app is backgrounded). The schedule is reconciled
 * idempotently from the current task list — done/deleted/past tasks are cancelled.
 *
 * No-ops outside Tauri (web). The native side needs `tauri-plugin-notification`
 * registered + the `notification:default` capability (see the design doc); until
 * then these calls are inert.
 */
import { isInTauri } from './tauriHelper';
import type { Note } from '@shared/lib/types';
import { isTask, isDone } from './taskFilters';
import { noteLinkTitle } from './noteLinks';

type NotifApi = typeof import('@tauri-apps/plugin-notification');
let _api: NotifApi | null = null;
async function api(): Promise<NotifApi | null> {
  if (!isInTauri()) return null;
  if (!_api) {
    try { _api = await import('@tauri-apps/plugin-notification'); }
    catch (e) { console.warn('[notif] plugin unavailable:', e); return null; }
  }
  return _api;
}

/** Deterministic positive 31-bit notification id for a note (reschedule replaces). */
export function notificationId(noteId: number): number {
  return (Math.abs(noteId) % 2_000_000_000) + 1;
}

const STORE_KEY = 'bkemoTaskNotifIds';
function loadIds(): number[] {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; }
}
function saveIds(ids: number[]) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(ids)); } catch { /* ignore */ }
}

/** Ensure OS notification permission, prompting once. Returns whether granted. */
export async function ensureNotificationPermission(): Promise<boolean> {
  const n = await api();
  if (!n) return false;
  try {
    if (await n.isPermissionGranted()) return true;
    return (await n.requestPermission()) === 'granted';
  } catch (e) {
    console.warn('[notif] permission check failed:', e);
    return false;
  }
}

type Due = { id: number; title: string; at: Date };
function dueOf(note: Note): Due | null {
  if (note.id == null || !isTask(note) || isDone(note) || !note.dueDate) return null;
  const at = new Date(note.dueDate as any);
  if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) return null; // future only
  return { id: notificationId(note.id), title: noteLinkTitle(note.content) || 'Task due', at };
}

/**
 * Reconcile scheduled notifications to match the given tasks. Cancels everything
 * we previously scheduled and (re)schedules the current set of future-due tasks —
 * cheap for the handful of upcoming tasks, and robust to due-date edits.
 * Does NOT prompt for permission (call `ensureNotificationPermission` first).
 */
export async function syncTaskNotifications(tasks: Note[]): Promise<void> {
  const n = await api();
  if (!n) return;
  try {
    if (!(await n.isPermissionGranted())) return;

    const desired: Due[] = [];
    const seen = new Set<number>();
    for (const t of tasks) {
      const d = dueOf(t);
      if (d && !seen.has(d.id)) { seen.add(d.id); desired.push(d); }
    }

    const prev = loadIds();
    if (prev.length) { try { await n.cancel(prev); } catch { /* ignore */ } }

    for (const d of desired) {
      n.sendNotification({
        id: d.id,
        title: d.title.slice(0, 80),
        body: 'Task due now',
        schedule: n.Schedule.at(d.at),
      });
    }
    saveIds(desired.map((d) => d.id));
  } catch (e) {
    console.warn('[notif] sync failed:', e);
  }
}

/** Cancel all task notifications we scheduled (e.g. when the setting is turned off). */
export async function clearTaskNotifications(): Promise<void> {
  const n = await api();
  if (!n) return;
  const ids = loadIds();
  if (ids.length) { try { await n.cancel(ids); } catch { /* ignore */ } }
  saveIds([]);
}
