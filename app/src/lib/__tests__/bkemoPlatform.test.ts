import { afterEach, describe, expect, test } from 'vitest';
import { bkemoPlatformHeaders, getBkemoPlatform } from '../bkemoPlatform';
import { BKEMO_PLATFORM_HEADER } from '@shared/lib/accessTokenPlatform';
import { resetShell, simulateShell } from '@/test/mocks/platform';

describe('bkemoPlatform', () => {
  afterEach(() => {
    resetShell();
  });

  test('defaults to web outside Tauri', () => {
    simulateShell('web');
    expect(getBkemoPlatform()).toBe('web');
    expect(bkemoPlatformHeaders()).toEqual({ [BKEMO_PLATFORM_HEADER]: 'web' });
  });

  test('reports macos inside the Tauri shell', () => {
    simulateShell('macos');
    expect(getBkemoPlatform()).toBe('macos');
    expect(bkemoPlatformHeaders()).toEqual({ [BKEMO_PLATFORM_HEADER]: 'macos' });
  });
});
