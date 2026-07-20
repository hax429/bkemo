import { describe, expect, test } from 'bun:test';
import { parseFrontmatter } from '../../../lib/bkemoTransfer';

describe('Markdown import fallback', () => {
  test('accepts ordinary Markdown without metadata', () => {
    const raw = '# Shopping\n\n- milk\n- coffee';
    expect(parseFrontmatter(raw)).toEqual({ metadata: {}, content: raw, plain: true });
  });

  test('treats malformed frontmatter as plain Markdown instead of throwing', () => {
    const raw = '---\ntitle: unfinished\n# still user content';
    expect(parseFrontmatter(raw)).toEqual({ metadata: {}, content: raw, plain: true });
  });

  test('preserves ordinary YAML frontmatter as part of plain Markdown', () => {
    const raw = '---\ntitle: Journal entry\ntags: [personal]\n---\n# Body';
    expect(parseFrontmatter(raw)).toEqual({ metadata: {}, content: raw, plain: true });
  });

  test('reads bkemo JSON-valued YAML frontmatter', () => {
    const parsed = parseFrontmatter('---\nbkemo: 1\nisImportant: true\ntags: ["work"]\n---\nBody');
    expect(parsed.plain).toBe(false);
    expect(parsed.metadata).toMatchObject({ bkemo: 1, isImportant: true, tags: ['work'] });
    expect(parsed.content).toBe('Body');
  });
});
