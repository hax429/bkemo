import { describe, expect, it } from 'vitest';
import { extractNoteLinkIds, NOTE_LINK_HREF_RE, noteLinkHref } from '../noteLinks';

describe('root memo links', () => {
  it('generates links without the removed /bkemo prefix', () => {
    expect(noteLinkHref(42)).toBe('/n/42');
  });

  it('continues recognizing legacy links embedded in memo content', () => {
    expect('/n/42'.match(NOTE_LINK_HREF_RE)?.[1]).toBe('42');
    expect('/bkemo/n/7'.match(NOTE_LINK_HREF_RE)?.[1]).toBe('7');
    expect(extractNoteLinkIds('[new](/n/42) [old](/bkemo/n/7) [dupe](/n/42)')).toEqual([42, 7]);
  });
});
