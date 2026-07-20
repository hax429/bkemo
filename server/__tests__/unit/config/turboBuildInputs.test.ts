import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('Turbo production build inputs', () => {
  test('invalidates the web build cache when source files change', () => {
    const turboConfig = JSON.parse(
      readFileSync(new URL('../../../../turbo.json', import.meta.url), 'utf8'),
    );

    expect(turboConfig.tasks['build:web'].inputs).toContain('$TURBO_DEFAULT$');
  });
});
