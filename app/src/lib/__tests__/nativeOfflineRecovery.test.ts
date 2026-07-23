import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConnectivityRecovery } from '@/lib/connectivity';
import { applyExternalNoteChange } from '@/lib/noteChange';
import { sessionFromStoredProfile } from '@/lib/nativeSessionCache';

afterEach(() => {
  vi.useRealTimers();
});

describe('native offline recovery', () => {
  it('restores an authenticated session from Keychain and cached profile without a network request', () => {
    expect(sessionFromStoredProfile('secret-token', JSON.stringify({
      user: { id: '42', name: 'Offline user' },
      expires: '2026-08-01T00:00:00.000Z',
    }))).toMatchObject({
      token: 'secret-token',
      user: { id: '42', name: 'Offline user' },
    });
  });

  it('makes a note saved by another webview immediately visible to the main view', async () => {
    const cache = vi.fn().mockResolvedValue(undefined);
    const reloadOffline = vi.fn();
    const invalidate = vi.fn();
    const note = { id: 7, content: 'Created in Quick Note' } as any;

    await applyExternalNoteChange(note, { cache, reloadOffline, invalidate });

    expect(cache).toHaveBeenCalledWith([note]);
    expect(reloadOffline).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('returns to online mode when a background health probe succeeds', async () => {
    vi.useFakeTimers();
    let online = false;
    const onOnline = vi.fn(() => { online = true; });
    const stop = createConnectivityRecovery({
      isOnline: () => online,
      probe: vi.fn().mockResolvedValue(true),
      onOnline,
      intervalMs: 1_000,
    });

    vi.advanceTimersByTime(1_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(onOnline).toHaveBeenCalledOnce();
    stop();
  });
});
