import { describe, expect, it } from 'vitest';
import { countWords, pageCharBudget, readingTimeMinutes, splitContentPages } from './utils';

describe('share image utils', () => {
  it('counts words ignoring fences', () => {
    expect(countWords('hello **world**\n\n```\ncode here\n```\none')).toBe(3);
  });

  it('reading time floors at 1', () => {
    expect(readingTimeMinutes('hi')).toBe(1);
    expect(readingTimeMinutes('')).toBe(0);
  });

  it('splits multipage content on budget', () => {
    const pages = splitContentPages('aaa\n\nbbb\n\nccc', 5);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join('\n\n')).toContain('aaa');
  });

  it('returns a sensible page budget', () => {
    expect(pageCharBudget('1:1')).toBeGreaterThan(200);
    expect(pageCharBudget('auto')).toBe(1800);
  });
});
