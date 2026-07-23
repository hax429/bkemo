import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyNoteSyncPayload, createNoteSyncController } from '@/lib/noteSync';

describe('cross-device note sync', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('writes changed notes, evicts removed notes, and invalidates once', async () => {
    const cache = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const invalidate = vi.fn();
    const changed = [{ id: 7, content: 'from another device' }] as any[];

    const applied = await applyNoteSyncPayload(
      { cursor: 12, changed, removedIds: [3, 4] },
      { cache, remove, invalidate },
    );

    expect(applied).toBe(true);
    expect(cache).toHaveBeenCalledWith(changed);
    expect(remove).toHaveBeenCalledWith([3, 4]);
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('does not invalidate for an empty cursor advance', async () => {
    const invalidate = vi.fn();

    const applied = await applyNoteSyncPayload(
      { cursor: 13, changed: [], removedIds: [] },
      {
        cache: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        invalidate,
      },
    );

    expect(applied).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('bootstraps reconciliation immediately on a normal page mount', async () => {
    const fetchChanges = vi.fn().mockResolvedValue({
      cursor: 21,
      changed: [],
      removedIds: [],
    });
    const onBootstrap = vi.fn();
    const apply = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {})) as any;

    const controller = createNoteSyncController({
      accountId: '42',
      token: 'token',
      streamUrl: '/api/v1/note/events',
      fetchChanges,
      apply,
      isOnline: () => true,
      onBootstrap,
      fetchImpl,
    });

    await vi.waitFor(() => {
      expect(fetchChanges).toHaveBeenCalledWith({ bootstrap: true });
      expect(localStorage.getItem('bkemo_note_sync_cursor:42')).toBe('21');
    });
    expect(onBootstrap).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledOnce();
    controller.dispose();
  });
});
