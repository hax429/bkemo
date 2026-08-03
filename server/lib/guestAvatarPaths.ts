export const GUEST_AVATAR_DIR = 'guest-avatars';
export const GUEST_AVATAR_MAX_BYTES = 512 * 1024;

const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
]);

export function isAllowedGuestAvatarMime(mime: string | undefined | null): boolean {
  return !!mime && ALLOWED_IMAGE_MIME.has(mime.toLowerCase());
}

/** True when a stored path is under the dedicated guest-avatar prefix. */
export function pathIsGuestAvatarStorage(storedPath: string | null | undefined): boolean {
  if (!storedPath) return false;
  return (
    storedPath.includes(`/${GUEST_AVATAR_DIR}/`)
    || storedPath.includes(`${GUEST_AVATAR_DIR}/`)
  );
}

export function attachmentIsGuestAvatar(attachment: {
  path?: string | null;
  metadata?: unknown;
} | null | undefined): boolean {
  if (!attachment) return false;
  if (pathIsGuestAvatarStorage(attachment.path)) return true;
  const meta = attachment.metadata;
  return !!(meta && typeof meta === 'object' && !Array.isArray(meta) && (meta as Record<string, unknown>).isGuestAvatar === true);
}
