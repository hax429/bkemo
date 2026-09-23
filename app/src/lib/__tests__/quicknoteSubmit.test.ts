import { describe, expect, it, vi } from 'vitest';
import { deliverQuickNote, isModifierEnter } from '../quicknoteSubmit';

describe('quicknote submission', () => {
  it('recognizes Command+Enter and Control+Enter', () => {
    expect(isModifierEnter({ key: 'Enter', metaKey: true, ctrlKey: false })).toBe(true);
    expect(isModifierEnter({ key: 'Enter', metaKey: false, ctrlKey: true })).toBe(true);
    expect(isModifierEnter({ key: 'Enter', metaKey: false, ctrlKey: false })).toBe(false);
  });

  it('hides before the background enqueue settles, then clears', async () => {
    const order: string[] = [];
    const clear = vi.fn(() => { order.push('clear'); });
    const hide = vi.fn(() => { order.push('hide'); });

    const delivered = deliverQuickNote({
      enqueue: () => new Promise((resolve) => {
        order.push('enqueue-start');
        setTimeout(() => {
          order.push('enqueue-done');
          resolve({ id: 42 });
        }, 20);
      }),
      clear,
      hide,
    });

    expect(hide).toHaveBeenCalledOnce();
    expect(clear).not.toHaveBeenCalled();
    expect(order).toEqual(['hide', 'enqueue-start']);

    await expect(delivered).resolves.toEqual({ id: 42 });
    expect(clear).toHaveBeenCalledOnce();
    expect(order).toEqual(['hide', 'enqueue-start', 'enqueue-done', 'clear']);
  });

  it('keeps the composer when enqueue is not accepted', async () => {
    const clear = vi.fn();
    const hide = vi.fn();

    await expect(deliverQuickNote({
      enqueue: async () => undefined,
      clear,
      hide,
    })).rejects.toThrow('Quick note was not accepted');

    expect(hide).toHaveBeenCalledOnce();
    expect(clear).not.toHaveBeenCalled();
  });
});
