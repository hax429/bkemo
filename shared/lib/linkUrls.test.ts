import { describe, expect, test } from 'bun:test';
import {
  extractBareUrlsFromMarkdown,
  firstWords,
  isApiLikeUrl,
  isNonHtmlContentType,
  normalizeUrl,
} from './linkUrls';

describe('linkUrls', () => {
  test('normalizeUrl adds https for www and strips trailing punctuation', () => {
    expect(normalizeUrl('www.example.com/path.')).toBe('https://www.example.com/path');
    expect(normalizeUrl('https://example.com/a),')).toBe('https://example.com/a');
  });

  test('extractBareUrlsFromMarkdown skips code and markdown links', () => {
    const md = [
      'See https://a.example/one and www.b.example/two.',
      'Already linked: [docs](https://skip.example/x)',
      '```',
      'https://code.example/nope',
      '```',
      'Inline `https://inline.example` stays.',
    ].join('\n');
    expect(extractBareUrlsFromMarkdown(md)).toEqual([
      'https://a.example/one',
      'https://www.b.example/two',
    ]);
  });

  test('isApiLikeUrl catches common API shapes', () => {
    expect(isApiLikeUrl('https://api.github.com/repos')).toBe(true);
    expect(isApiLikeUrl('https://example.com/api/v1/notes')).toBe(true);
    expect(isApiLikeUrl('https://example.com/data.json')).toBe(true);
    expect(isApiLikeUrl('https://example.com/blog/post')).toBe(false);
  });

  test('isNonHtmlContentType', () => {
    expect(isNonHtmlContentType('application/json; charset=utf-8')).toBe(true);
    expect(isNonHtmlContentType('text/html; charset=utf-8')).toBe(false);
    expect(isNonHtmlContentType('image/png')).toBe(true);
  });

  test('firstWords truncates', () => {
    expect(firstWords('one two three four five', 3)).toBe('one two three…');
    expect(firstWords('short', 20)).toBe('short');
  });
});
