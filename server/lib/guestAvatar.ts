import { attachmentPortableIdFromPath } from './attachmentPaths';
import { prisma } from '../prisma';
import {
  attachmentIsGuestAvatar,
  pathIsGuestAvatarStorage,
} from './guestAvatarPaths';

/**
 * Validate a client-supplied guestAvatar URL before storing it on a comment.
 * Only same-origin API attachment/file paths that are guest-avatar uploads are allowed.
 */
export async function isAllowedGuestAvatarReference(raw: string | undefined | null): Promise<boolean> {
  if (!raw || typeof raw !== 'string') return false;
  let pathname = raw.trim();
  if (!pathname) return false;
  try {
    if (/^https?:\/\//i.test(pathname)) {
      pathname = new URL(pathname).pathname;
    }
  } catch {
    return false;
  }
  pathname = pathname.split('?')[0] ?? pathname;

  if (pathname.startsWith('/api/file/') || pathname.startsWith('/api/s3file/')) {
    if (!pathIsGuestAvatarStorage(pathname)) return false;
    const attachment = await prisma.attachments.findFirst({
      where: { path: pathname },
      select: { path: true, metadata: true },
    });
    if (!attachment) return pathIsGuestAvatarStorage(pathname);
    return attachmentIsGuestAvatar(attachment);
  }

  const portableId = attachmentPortableIdFromPath(pathname);
  if (!portableId) return false;
  const attachment = await prisma.attachments.findUnique({
    where: { portableId },
    select: { path: true, metadata: true },
  });
  return attachmentIsGuestAvatar(attachment);
}
