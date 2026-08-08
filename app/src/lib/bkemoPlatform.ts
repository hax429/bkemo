import { isInTauri } from './tauriHelper';
import { BKEMO_PLATFORM_HEADER, type AccessTokenPlatform } from '@shared/lib/accessTokenPlatform';

/** Declared client platform for access-token misuse signaling. */
export function getBkemoPlatform(): AccessTokenPlatform {
  if (typeof window !== 'undefined' && isInTauri()) return 'macos';
  return 'web';
}

export function bkemoPlatformHeaders(): Record<string, string> {
  return { [BKEMO_PLATFORM_HEADER]: getBkemoPlatform() };
}
