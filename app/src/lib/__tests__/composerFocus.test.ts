import { describe, expect, it, vi } from 'vitest';
import { consumeComposerFocus, pathHasComposer, requestComposerFocus } from '../composerFocus';
import { eventBus } from '../event';
import { pressable } from '../pressable';

describe('composerFocus', () => {
  it('keeps the request pending until a composer consumes it once', () => {
    const listener = vi.fn();
    eventBus.on('bkemo:focus-composer', listener);
    requestComposerFocus();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(consumeComposerFocus()).toBe(true);
    expect(consumeComposerFocus()).toBe(false);
    eventBus.off('bkemo:focus-composer', listener);
  });

  it('knows which routes render the inline composer', () => {
    expect(pathHasComposer('/')).toBe(true);
    expect(pathHasComposer('/tag/work')).toBe(true);
    expect(pathHasComposer('/settings/data')).toBe(false);
    expect(pathHasComposer('/today')).toBe(false);
  });
});

describe('pressable', () => {
  it('activates on Enter and Space only', () => {
    const onActivate = vi.fn();
    const props = pressable(onActivate, true);
    const key = (k: string) => ({ key: k, preventDefault: vi.fn() }) as any;
    props.onKeyDown(key('Enter'));
    props.onKeyDown(key(' '));
    props.onKeyDown(key('a'));
    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(props).toMatchObject({ role: 'button', tabIndex: 0, 'aria-current': 'page' });
  });
});
