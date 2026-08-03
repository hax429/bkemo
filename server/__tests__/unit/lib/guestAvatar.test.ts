import { describe, expect, test } from 'bun:test';
import { pathIsGuestAvatarStorage, isAllowedGuestAvatarMime, GUEST_AVATAR_DIR } from '../../../lib/guestAvatarPaths';

describe('guestAvatar helpers', () => {
  test('detects guest-avatar storage paths', () => {
    expect(pathIsGuestAvatarStorage(`/api/file/${GUEST_AVATAR_DIR}/a.png`)).toBe(true);
    expect(pathIsGuestAvatarStorage(`/api/s3file/${GUEST_AVATAR_DIR}/a.png`)).toBe(true);
    expect(pathIsGuestAvatarStorage('/api/file/notes/secret.pdf')).toBe(false);
  });

  test('allows only common image mime types', () => {
    expect(isAllowedGuestAvatarMime('image/png')).toBe(true);
    expect(isAllowedGuestAvatarMime('image/svg+xml')).toBe(false);
    expect(isAllowedGuestAvatarMime('application/pdf')).toBe(false);
  });
});
