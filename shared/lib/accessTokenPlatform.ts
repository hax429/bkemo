/**
 * Platform binding for managed access tokens.
 * Enforcement is soft (misuse warning); the header is an anomaly signal, not attestation.
 */

export const ACCESS_TOKEN_PLATFORMS = ['web', 'macos', 'ios', 'obsidian', 'api'] as const;
export type AccessTokenPlatform = (typeof ACCESS_TOKEN_PLATFORMS)[number];

export const ACCESS_TOKEN_PLATFORM_LABELS: Record<AccessTokenPlatform, string> = {
  web: 'Web',
  macos: 'macOS',
  ios: 'iOS',
  obsidian: 'Obsidian',
  api: 'API / scripts',
};

export const BKEMO_PLATFORM_HEADER = 'x-bkemo-platform';

/** Internal scope: native app login mints this for full session-equivalent access. */
export const APP_FULL_SCOPE = 'app:full';

export const ACCESS_TOKEN_ACCOUNT_CAP = 50;

export function isAccessTokenPlatform(value: unknown): value is AccessTokenPlatform {
  return typeof value === 'string' && (ACCESS_TOKEN_PLATFORMS as readonly string[]).includes(value);
}

/** Normalize a header / body value; unknown or missing → `unknown`. */
export function normalizeDeclaredPlatform(raw: unknown): AccessTokenPlatform | 'unknown' {
  if (typeof raw !== 'string') return 'unknown';
  const value = raw.trim().toLowerCase();
  return isAccessTokenPlatform(value) ? value : 'unknown';
}
