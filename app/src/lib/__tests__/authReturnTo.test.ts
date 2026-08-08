import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { consumeAuthReturnTo, safeReturnTo, stashAuthReturnTo } from '../authReturnTo';

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); },
      removeItem: (key: string) => { memory.delete(key); },
      clear: () => memory.clear(),
      get length() { return memory.size; },
      key: () => null,
    },
  });
});

afterEach(() => {
  memory.clear();
});

describe('authReturnTo', () => {
  test('accepts only same-origin relative paths', () => {
    expect(safeReturnTo('/oauth/authorize?client_id=1')).toBe('/oauth/authorize?client_id=1');
    expect(safeReturnTo('//evil.example')).toBe('/');
    expect(safeReturnTo('https://evil.example')).toBe('/');
    expect(safeReturnTo(null)).toBe('/');
  });

  test('stashes and consumes returnTo across the SSO round trip', () => {
    stashAuthReturnTo('/oauth/authorize?x=1');
    expect(consumeAuthReturnTo()).toBe('/oauth/authorize?x=1');
    expect(consumeAuthReturnTo()).toBe('/');
  });

  test('rejects stashed open redirects', () => {
    stashAuthReturnTo('//evil.example/phish');
    expect(consumeAuthReturnTo()).toBe('/');
  });
});
