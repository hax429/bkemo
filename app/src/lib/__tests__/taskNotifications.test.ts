import { describe, it, expect } from 'vitest';
import { notificationId } from '../taskNotifications';

// Phase 6 — the notification id must be a stable, positive 31-bit int so a
// reschedule replaces (never duplicates) a task's pending OS notification.
describe('notificationId', () => {
  it('is deterministic for a given note id', () => {
    expect(notificationId(42)).toBe(notificationId(42));
    expect(notificationId(123456)).toBe(notificationId(123456));
  });

  it('stays a positive 31-bit integer', () => {
    for (const id of [0, 1, 42, 999, 2_147_483_647, 5_000_000_000]) {
      const n = notificationId(id);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(2_000_000_001);
    }
  });

  it('treats negative ids by magnitude (still positive)', () => {
    expect(notificationId(-7)).toBe(notificationId(7));
  });

  it('gives distinct ids for distinct small note ids', () => {
    const ids = new Set([1, 2, 3, 4, 5].map(notificationId));
    expect(ids.size).toBe(5);
  });
});
