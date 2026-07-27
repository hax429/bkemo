import { describe, expect, test } from 'bun:test';
import { canClaimDraft, DRAFT_LEASE_MS, draftLeaseExpiry } from '../../../routerTrpc/draft';

describe('compose draft writer lease', () => {
  const now = new Date('2026-07-26T12:00:00.000Z');

  test('uses a two-minute server-time lease', () => {
    expect(DRAFT_LEASE_MS).toBe(120_000);
    expect(draftLeaseExpiry(now)).toEqual(new Date('2026-07-26T12:02:00.000Z'));
  });

  test('allows the current writer to renew but blocks another active writer', () => {
    const draft = { writerId: 'writer-a', leaseExpiresAt: draftLeaseExpiry(now) };
    expect(canClaimDraft(draft, 'writer-a', now)).toBe(true);
    expect(canClaimDraft(draft, 'writer-b', now)).toBe(false);
  });

  test('allows another writer only after expiry', () => {
    const draft = { writerId: 'writer-a', leaseExpiresAt: now };
    expect(canClaimDraft(draft, 'writer-b', now)).toBe(true);
  });
});
