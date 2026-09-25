import { eventBus } from '@/lib/event';

/**
 * "New note" (⌘N / sidebar) focuses the inline composer instead of opening
 * the full-window editor. The request may arrive before the composer is
 * mounted (e.g. from Settings, which first navigates home), so it is kept as
 * a pending flag the composer consumes on mount as well as on the event.
 */
let pending = false;

export function requestComposerFocus(): void {
  pending = true;
  eventBus.emit('bkemo:focus-composer');
}

export function consumeComposerFocus(): boolean {
  const was = pending;
  pending = false;
  return was;
}

/** Stream routes render the inline composer. */
export function pathHasComposer(pathname: string): boolean {
  return pathname === '/' || pathname.startsWith('/tag/');
}
