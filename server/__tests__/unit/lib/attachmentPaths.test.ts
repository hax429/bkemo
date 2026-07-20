import { describe, expect, test } from 'bun:test';
import { attachmentPortableIdFromPath, stableAttachmentPath } from '../../../lib/attachmentPaths';

describe('provider-neutral attachment paths', () => {
  test('round-trips a portable attachment id', () => {
    const id = '508dd779-f909-48a0-b6f3-656b0b7bcdd7';
    const path = stableAttachmentPath(id);
    expect(path).toBe(`/api/attachment/${id}/file`);
    expect(attachmentPortableIdFromPath(path)).toBe(id);
    expect(attachmentPortableIdFromPath(`${path}?thumbnail=true`)).toBe(id);
  });

  test('does not treat physical provider paths as stable paths', () => {
    expect(attachmentPortableIdFromPath('/api/file/example.png')).toBeNull();
    expect(attachmentPortableIdFromPath('/api/s3file/example.png')).toBeNull();
  });
});
