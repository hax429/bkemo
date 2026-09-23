import { describe, expect, test } from 'bun:test';
import { BASE_TOKEN_PATHS, SETTINGS_PRIVILEGED_PATHS, SETTINGS_REDACTED_READS, expandScopes } from '@shared/lib/accessTokenScopes';
import { allowsSettingsPath, needsRedactedGrant, settingsOperations } from '@server/lib/nativeSettings';
import { tokenAllowsPath } from '@shared/lib/tokenPathMatch';

// Paths a scoped macOS/iOS session calls while loading Home. Any gap here
// surfaces as "This token does not have permission to access this endpoint".
const HOME_READ = ['notes.list', 'notes.streamCount', 'users.detail', 'linkEnrichment.getByUrl'];
const HOME_WRITE = ['draft.get', 'draft.snapshot', 'draft.finalize', 'draft.clear', 'notes.upsert'];

describe('expandScopes', () => {
  test('every scoped token gets the base paths', () => {
    const perms = expandScopes(['tags:read']);
    for (const p of BASE_TOKEN_PATHS) expect(tokenAllowsPath(perms, p)).toBe(true);
  });

  test('view-only native preset covers Home reads but not drafts', () => {
    const perms = expandScopes(['notes:read', 'tags:read', 'attachments:read', 'comments:read']);
    for (const p of HOME_READ) expect(tokenAllowsPath(perms, p)).toBe(true);
    expect(tokenAllowsPath(perms, 'draft.finalize')).toBe(false);
  });

  test('notes:write covers the composer draft', () => {
    const perms = expandScopes(['notes:read', 'notes:write']);
    for (const p of [...HOME_READ, ...HOME_WRITE]) expect(tokenAllowsPath(perms, p)).toBe(true);
  });

  test('base paths do not leak admin endpoints', () => {
    const perms = expandScopes(['notes:read']);
    expect(tokenAllowsPath(perms, 'users.list')).toBe(false);
    expect(tokenAllowsPath(perms, 'config.update')).toBe(false);
  });
});

describe('settings scope', () => {
  const perms = expandScopes(['settings']);

  test('reaches every native settings operation except privileged ones', () => {
    for (const op of settingsOperations) {
      const allowed = allowsSettingsPath(perms, op.id);
      expect({ op: op.id, allowed }).toEqual({ op: op.id, allowed: !SETTINGS_PRIVILEGED_PATHS.includes(op.id) });
    }
  });

  test('secret-bearing reads are native-settings-only (redacted), never direct', () => {
    for (const p of SETTINGS_REDACTED_READS) {
      expect(tokenAllowsPath(perms, p)).toBe(false);
      expect(needsRedactedGrant(perms, p)).toBe(true);
    }
    expect(needsRedactedGrant(expandScopes(['notes:read']), 'ai.getAllProviders')).toBe(false);
  });

  test('never lets a scoped token escalate', () => {
    for (const p of SETTINGS_PRIVILEGED_PATHS) {
      expect(tokenAllowsPath(perms, p)).toBe(false);
      expect(allowsSettingsPath(perms, p)).toBe(false);
    }
    expect(tokenAllowsPath(perms, 'users.impersonate')).toBe(false);
  });
});
