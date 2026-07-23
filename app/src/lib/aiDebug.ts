/**
 * Dev-only AI debug channel. Available only under Vite DEV builds; the toggle
 * and panel are tree-shaken / gated out of production.
 */

export type AIDebugLevel = 'info' | 'warn' | 'error' | 'event' | 'server';

export type AIDebugEntry = {
  id: number;
  t: number;
  level: AIDebugLevel;
  phase: string;
  message?: string;
  data?: unknown;
};

const STORAGE_KEY = 'bkemo.aiDebug.enabled';
const MAX_ENTRIES = 400;

let seq = 0;
let enabled = false;
const entries: AIDebugEntry[] = [];
const listeners = new Set<() => void>();

function canUseAiDebug() {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

function notify() {
  listeners.forEach((listener) => listener());
}

function readStoredEnabled() {
  if (!canUseAiDebug() || typeof sessionStorage === 'undefined') return false;
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

enabled = readStoredEnabled();

/** True only in Vite development builds. Production always false. */
export function isAiDebugAvailable() {
  return canUseAiDebug();
}

export function isAiDebugEnabled() {
  return canUseAiDebug() && enabled;
}

export function setAiDebugEnabled(next: boolean) {
  if (!canUseAiDebug()) {
    enabled = false;
    return;
  }
  enabled = !!next;
  try {
    if (enabled) sessionStorage.setItem(STORAGE_KEY, '1');
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore quota / private mode
  }
  notify();
}

export function clearAiDebugLog() {
  entries.length = 0;
  notify();
}

export function getAiDebugEntries(): readonly AIDebugEntry[] {
  return entries;
}

export function subscribeAiDebug(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function aiDebugLog(
  phase: string,
  data?: unknown,
  level: AIDebugLevel = 'info',
  message?: string,
) {
  if (!isAiDebugEnabled()) return;
  seq += 1;
  entries.push({
    id: seq,
    t: Date.now(),
    level,
    phase,
    message,
    data: sanitize(data),
  });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  notify();
  if (typeof console !== 'undefined') {
    const prefix = `[ai-debug ${phase}]`;
    if (level === 'error') console.error(prefix, message ?? '', data ?? '');
    else if (level === 'warn') console.warn(prefix, message ?? '', data ?? '');
    else console.debug(prefix, message ?? '', data ?? '');
  }
}

function sanitize(value: unknown, depth = 0): unknown {
  if (value == null || depth > 4) return value;
  if (typeof value === 'string') {
    return value.length > 1200 ? `${value.slice(0, 1200)}…` : value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 40).map((item) => sanitize(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
    if (/apiKey|authorization|password|token|secret/i.test(key)) {
      out[key] = '[redacted]';
      continue;
    }
    out[key] = sanitize(item, depth + 1);
  }
  return out;
}

export function describeAiError(cause: unknown) {
  const err = cause as any;
  const message = String(err?.message || err || 'unknown error');
  const name = String(err?.name || '');
  const aborted =
    name === 'AbortError'
    || /aborted|BodyStreamBuffer|AbortError/i.test(message);
  // streamApi uses AbortSignal.timeout(15m); older builds used 5m (≈300000ms).
  const timeoutLike = aborted && /BodyStreamBuffer|The operation was aborted/i.test(message);
  return {
    name,
    message,
    aborted,
    timeoutLike,
    code: err?.data?.code ?? err?.code,
    cause: err?.cause ? String(err.cause?.message || err.cause) : undefined,
  };
}
