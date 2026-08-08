import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { contentHash } from './hash.js';

describe('contentHash', () => {
  it('returns a stable sha256 prefix hash', async () => {
    const hash = await contentHash('Write the report #work');
    assert.match(hash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(hash, await contentHash('Write the report #work'));
    assert.notEqual(hash, await contentHash('Write the report #play'));
  });
});
