import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getBlinkoEndpoint, getSavedEndpoint, saveBlinkoEndpoint } from '../blinkoEndpoint';

// Phase 6 — the bundled Tauri shell must resolve API URLs against
// https://bk.hax429.me with no user input on first launch, while a saved
// endpoint (or plain web origin) still wins where present.
const setTauri = (on: boolean) => {
  if (on) (window as any).__TAURI__ = {};
  else delete (window as any).__TAURI__;
};

describe('blinkoEndpoint', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setTauri(false);
  });
  afterEach(() => {
    window.localStorage.clear();
    setTauri(false);
  });

  it('defaults to bk.hax429.me under Tauri when nothing is saved', () => {
    setTauri(true);
    expect(getSavedEndpoint()).toBe('https://bk.hax429.me');
    expect(getBlinkoEndpoint('/api/v1/note/list')).toBe(
      'https://bk.hax429.me/api/v1/note/list',
    );
  });

  it('uses a saved endpoint override under Tauri', () => {
    setTauri(true);
    saveBlinkoEndpoint('https://example.test');
    expect(getSavedEndpoint()).toBe('https://example.test');
    expect(getBlinkoEndpoint('/api/x')).toBe('https://example.test/api/x');
  });

  it('strips quotes/whitespace from a saved endpoint', () => {
    setTauri(true);
    window.localStorage.setItem('blinkoEndpoint', '  "https://quoted.test"  ');
    expect(getSavedEndpoint()).toBe('https://quoted.test');
  });

  it('falls back to the web origin when not in Tauri', () => {
    setTauri(false);
    expect(getSavedEndpoint()).toBe('');
    expect(getBlinkoEndpoint('/api/y')).toBe(`${window.location.origin}/api/y`);
  });
});
