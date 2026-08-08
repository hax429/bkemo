/**
 * Helpers to simulate the web vs macOS Tauri shell in component tests.
 * Mac and web share React UI; only `window.__TAURI__` and platform headers differ.
 */

export type SimulatedShell = 'web' | 'macos';

/** Install or clear the Tauri global used by `isInTauri()`. */
export function simulateShell(shell: SimulatedShell): void {
  if (shell === 'macos') {
    (window as Window & { __TAURI__?: object }).__TAURI__ = { mock: true };
    return;
  }
  delete (window as Window & { __TAURI__?: object }).__TAURI__;
}

export function resetShell(): void {
  delete (window as Window & { __TAURI__?: object }).__TAURI__;
}
