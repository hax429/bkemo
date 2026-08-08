import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const styles = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');

describe('sidebar card layout', () => {
  it('keeps memo cards at content height inside the scrolling flex feed', () => {
    const memoRule = styles.match(/\.bkemo-memo\s*\{([^}]*)\}/)?.[1] ?? '';
    assert.match(memoRule, /flex:\s*0\s+0\s+auto\s*;/);
  });

  it('spaces bordered memo cards and aligns the bottom dock around the feed scrollbar', () => {
    const feedRule = styles.match(/\.bkemo-feed\s*\{([^}]*)\}/)?.[1] ?? '';
    assert.match(feedRule, /gap:\s*8px\s*;/);
    assert.match(feedRule, /padding:\s*8px\s+10px\s*;/);
    const memoRule = styles.match(/\.bkemo-memo\s*\{([^}]*)\}/)?.[1] ?? '';
    assert.match(memoRule, /border:\s*1px\s+solid/);
    assert.match(memoRule, /border-radius:\s*var\(--bk-radius\)/);
    const dockRule = styles.match(/\.bkemo-dock\s*\{([^}]*)\}/)?.[1] ?? '';
    assert.match(dockRule, /padding:\s*8px\s+18px\s+8px\s+10px\s*;/);
  });
});
