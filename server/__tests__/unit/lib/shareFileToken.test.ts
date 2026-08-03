import { describe, expect, test } from 'bun:test';
import { appendShareFileToken, mintShareFileToken, verifyShareFileToken } from '../../../lib/shareFileToken';

describe('shareFileToken', () => {
  test('mints and verifies for the same note', () => {
    const token = mintShareFileToken(42, 'site-abc');
    expect(verifyShareFileToken(token, 42)).toBe(true);
    expect(verifyShareFileToken(token, 99)).toBe(false);
    expect(verifyShareFileToken('garbage', 42)).toBe(false);
  });

  test('appends token as query param', () => {
    expect(appendShareFileToken('/api/file/x.png', 'tok')).toBe('/api/file/x.png?shareFileToken=tok');
    expect(appendShareFileToken('/api/file/x.png?thumbnail=true', 'tok')).toBe(
      '/api/file/x.png?thumbnail=true&shareFileToken=tok',
    );
  });
});
