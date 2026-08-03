import { describe, expect, test } from 'vitest';
import { isPreviewableHref, safeHref } from '../safeMarkdown';

describe('safeMarkdown', () => {
  test('blocks dangerous href schemes', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('data:text/html,<script>')).toBeUndefined();
    expect(safeHref('vbscript:msgbox(1)')).toBeUndefined();
  });

  test('allows http(s) and relative links', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com');
    expect(safeHref('/m/abc')).toBe('/m/abc');
    expect(isPreviewableHref('https://example.com')).toBe(true);
    expect(isPreviewableHref('/m/abc')).toBe(false);
    expect(isPreviewableHref('javascript:alert(1)')).toBe(false);
  });
});
