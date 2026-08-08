import { describe, expect, test } from 'bun:test';
import {
  isAccessTokenPlatform,
  normalizeDeclaredPlatform,
  ACCESS_TOKEN_PLATFORMS,
} from '@shared/lib/accessTokenPlatform';
import { scopesForObsidian, hasObsidianConnectAccess } from '@server/lib/obsidianContracts';

describe('accessTokenPlatform', () => {
  test('accepts known platforms', () => {
    for (const platform of ACCESS_TOKEN_PLATFORMS) {
      expect(isAccessTokenPlatform(platform)).toBe(true);
    }
    expect(isAccessTokenPlatform('android')).toBe(false);
  });

  test('normalizes declared platform header values', () => {
    expect(normalizeDeclaredPlatform('macOS')).toBe('macos');
    expect(normalizeDeclaredPlatform('  ios ')).toBe('ios');
    expect(normalizeDeclaredPlatform('')).toBe('unknown');
    expect(normalizeDeclaredPlatform(undefined)).toBe('unknown');
    expect(normalizeDeclaredPlatform('bot')).toBe('unknown');
  });
});

describe('scopesForObsidian with app:full', () => {
  test('expands app:full to Obsidian connect scopes', () => {
    const scopes = scopesForObsidian(['app:full']);
    expect(hasObsidianConnectAccess(scopes)).toBe(true);
    expect(scopes).toContain('notes:read');
    expect(scopes).toContain('attachments:write');
  });
});
