/**
 * Stable anonymous id for guests reacting/commenting on public shared memos.
 * Persisted in localStorage so a visitor's reactions toggle consistently.
 */
const KEY = 'bkemoGuestId';

export function getGuestId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = 'guest-' + (crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'guest-anon';
  }
}

const NAME_KEY = 'bkemoGuestName';
export function getGuestName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}
export function setGuestName(name: string): void {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* ignore */ }
}
