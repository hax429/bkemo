import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyNoteSyncPayload, createNoteSyncController } from '@/lib/noteSync';

const flushMicrotasks = async () => {
  for (let index = 0; index < 5; index++) await Promise.resolve();
};

const createEventStream = () => {
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });
  const encoder = new TextEncoder();
  return {
    response: new Response(stream, { status: 200 }),
    push: (event: string) => streamController.enqueue(encoder.encode(event)),
    close: () => streamController.close(),
  };
};

describe('cross-device note sync', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
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

  it('polls every 60 seconds while active, then stops after five idle minutes', async () => {
    vi.useFakeTimers();
    localStorage.setItem('bkemo_note_sync_cursor:active', '10');
    const fetchChanges = vi.fn().mockResolvedValue({
      cursor: 10,
      changed: [],
      removedIds: [],
    });
    const controller = createNoteSyncController({
      accountId: 'active',
      token: 'token',
      streamUrl: '/events',
      fetchChanges,
      apply: vi.fn().mockResolvedValue(undefined),
      isOnline: () => true,
      onBootstrap: vi.fn(),
      fetchImpl: vi.fn(() => new Promise<Response>(() => {})) as any,
    });

    await flushMicrotasks();
    expect(fetchChanges).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(fetchChanges).toHaveBeenCalledTimes(5);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchChanges).toHaveBeenCalledTimes(5);
    controller.dispose();
  });

  it('keeps SSE connected while idle and reconciles dirty events', async () => {
    vi.useFakeTimers();
    localStorage.setItem('bkemo_note_sync_cursor:sse', '4');
    const eventStream = createEventStream();
    let streamSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      streamSignal = init?.signal as AbortSignal;
      return Promise.resolve(eventStream.response);
    }) as any;
    const fetchChanges = vi.fn().mockResolvedValue({
      cursor: 4,
      changed: [],
      removedIds: [],
    });
    const controller = createNoteSyncController({
      accountId: 'sse',
      token: 'token',
      streamUrl: '/events',
      fetchChanges,
      apply: vi.fn().mockResolvedValue(undefined),
      isOnline: () => true,
      onBootstrap: vi.fn(),
      fetchImpl,
    });

    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetchChanges).toHaveBeenCalledTimes(5);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(streamSignal?.aborted).toBe(false);

    eventStream.push('event: dirty\ndata: {}\n\n');
    await flushMicrotasks();
    expect(fetchChanges).toHaveBeenCalledTimes(6);

    eventStream.push('event: dirty\ndata: {"kind":"draft"}\n\n');
    await flushMicrotasks();
    expect(fetchChanges).toHaveBeenCalledTimes(6);

    eventStream.push('event: dirty\ndata: {"kind":"note"}\n\n');
    await flushMicrotasks();
    expect(fetchChanges).toHaveBeenCalledTimes(7);
    controller.dispose();
  });

  it('catches up immediately and resumes polling when pointer or keyboard activity returns', async () => {
    vi.useFakeTimers();
    localStorage.setItem('bkemo_note_sync_cursor:activity', '8');
    const fetchChanges = vi.fn().mockResolvedValue({
      cursor: 8,
      changed: [],
      removedIds: [],
    });
    const controller = createNoteSyncController({
      accountId: 'activity',
      token: 'token',
      streamUrl: '/events',
      fetchChanges,
      apply: vi.fn().mockResolvedValue(undefined),
      isOnline: () => true,
      onBootstrap: vi.fn(),
      fetchImpl: vi.fn(() => new Promise<Response>(() => {})) as any,
    });

    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetchChanges).toHaveBeenCalledTimes(5);

    window.dispatchEvent(new Event('pointermove'));
    await flushMicrotasks();
    expect(fetchChanges).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchChanges).toHaveBeenCalledTimes(7);

    await vi.advanceTimersByTimeAsync(4 * 60_000);
    window.dispatchEvent(new Event('keydown'));
    await flushMicrotasks();
    expect(fetchChanges).toHaveBeenCalledTimes(11);
    controller.dispose();
  });

  it('catches up on focus, online recovery, and SSE reconnect', async () => {
    vi.useFakeTimers();
    localStorage.setItem('bkemo_note_sync_cursor:resume', '2');
    let online = true;
    const streams = [createEventStream(), createEventStream(), createEventStream()];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(streams[0].response)
      .mockResolvedValueOnce(streams[1].response)
      .mockResolvedValueOnce(streams[2].response) as any;
    const fetchChanges = vi.fn().mockResolvedValue({
      cursor: 2,
      changed: [],
      removedIds: [],
    });
    const controller = createNoteSyncController({
      accountId: 'resume',
      token: 'token',
      streamUrl: '/events',
      fetchChanges,
      apply: vi.fn().mockResolvedValue(undefined),
      isOnline: () => online,
      onBootstrap: vi.fn(),
      fetchImpl,
    });

    await flushMicrotasks();
    window.dispatchEvent(new Event('focus'));
    await flushMicrotasks();
    expect(fetchChanges).toHaveBeenCalledTimes(2);

    online = false;
    window.dispatchEvent(new Event('offline'));
    online = true;
    window.dispatchEvent(new Event('online'));
    await flushMicrotasks();
    expect(fetchChanges).toHaveBeenCalledTimes(3);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    streams[1].close();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchChanges).toHaveBeenCalledTimes(4);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    controller.dispose();
  });

  it('cleans up activity, lifecycle, reconnect, and polling work on dispose', async () => {
    vi.useFakeTimers();
    localStorage.setItem('bkemo_note_sync_cursor:dispose', '1');
    const eventStream = createEventStream();
    let streamSignal: AbortSignal | undefined;
    const fetchChanges = vi.fn().mockResolvedValue({
      cursor: 1,
      changed: [],
      removedIds: [],
    });
    const controller = createNoteSyncController({
      accountId: 'dispose',
      token: 'token',
      streamUrl: '/events',
      fetchChanges,
      apply: vi.fn().mockResolvedValue(undefined),
      isOnline: () => true,
      onBootstrap: vi.fn(),
      fetchImpl: vi.fn((_url: string, init?: RequestInit) => {
        streamSignal = init?.signal as AbortSignal;
        return Promise.resolve(eventStream.response);
      }) as any,
    });

    await flushMicrotasks();
    controller.dispose();
    expect(streamSignal?.aborted).toBe(true);

    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new Event('keydown'));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchChanges).toHaveBeenCalledOnce();
  });
});
