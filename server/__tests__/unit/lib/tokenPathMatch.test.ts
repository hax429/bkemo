import { describe, expect, test } from 'bun:test';
import { tokenAllowsPath } from '@shared/lib/tokenPathMatch';

describe('tokenAllowsPath', () => {
  test('exact path match', () => {
    expect(tokenAllowsPath(['notes.list'], 'notes.list')).toBe(true);
    expect(tokenAllowsPath(['notes.list'], 'notes.listByIds')).toBe(false);
    expect(tokenAllowsPath(['notes.upsert'], 'notes.list')).toBe(false);
  });

  test('prefix grants ending with dot', () => {
    expect(tokenAllowsPath(['notifications.'], 'notifications.list')).toBe(true);
    expect(tokenAllowsPath(['notifications.'], 'notifications')).toBe(true);
    expect(tokenAllowsPath(['notifications.'], 'notes.list')).toBe(false);
  });

  test('rejects substring over-grants', () => {
    expect(tokenAllowsPath(['e'], 'notes.changes')).toBe(false);
    expect(tokenAllowsPath(['notes'], 'notes.list')).toBe(false);
  });
});
