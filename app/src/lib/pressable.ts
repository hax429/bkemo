import type { KeyboardEvent } from 'react';

/**
 * Button semantics for clickable rows that are styled `<div>`s: focusable by
 * Tab, announced as buttons, and activated by Enter or Space.
 */
export function pressable(onActivate?: () => void, selected?: boolean) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    ...(selected !== undefined ? { 'aria-current': selected ? ('page' as const) : undefined } : {}),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onActivate?.();
    },
  };
}
