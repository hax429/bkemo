import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentVaultPath } from './attachmentPaths.js';
import { assertPathUnderRoot } from './frontmatter.js';
import type { BkemoAttachment } from '../types.js';

const attachment: BkemoAttachment = {
  portableId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  name: '../evil/name?.png',
  type: 'image/png',
  size: 12,
};

describe('copy attachment paths', () => {
  it('keeps copied attachments under the configured vault root', () => {
    const path = attachmentVaultPath('67b2d411-221e-4dbe-98a4-d6db7c98c793', attachment, 'bkemo');
    assert.equal(
      path,
      'bkemo/attachments/67b2d411-221e-4dbe-98a4-d6db7c98c793/.._evil_name_.png',
    );
    assert.equal(assertPathUnderRoot(path, 'bkemo'), path);
    assert.throws(() => assertPathUnderRoot('../secret.png', 'bkemo'));
  });
});
