import { describe, expect, it, vi } from 'vitest';
import { deliverQuickNote, isModifierEnter } from '../quicknoteSubmit';

describe('quicknote submission', () => {
  it('recognizes Command+Enter and Control+Enter', () => {
    expect(isModifierEnter({ key: 'Enter', metaKey: true, ctrlKey: false })).toBe(true);
    expect(isModifierEnter({ key: 'Enter', metaKey: false, ctrlKey: true })).toBe(true);
    expect(isModifierEnter({ key: 'Enter', metaKey: false, ctrlKey: false })).toBe(false);
  });

  it('does not clear or hide when the save was not accepted', async () => {
    const clear = vi.fn();
    const hide = vi.fn();

    await expect(deliverQuickNote({
      save: async () => undefined,
      clear,
      hide,
    })).rejects.toThrow('Quick note was not accepted');

    expect(clear).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
  });

  it('clears and hides only after a successful save', async () => {
    const clear = vi.fn();
    const hide = vi.fn();

    await deliverQuickNote({
      save: async () => ({ id: 42 }),
      clear,
      hide,
    });

    expect(clear).toHaveBeenCalledOnce();
    expect(hide).toHaveBeenCalledOnce();
  });
});
