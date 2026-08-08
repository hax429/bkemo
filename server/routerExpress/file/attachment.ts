import express from 'express';
import { prisma } from '../../prisma';
import { getTokenFromRequest } from '../../lib/helper';
import { stableAttachmentPath } from '../../lib/attachmentPaths';
import { attachmentIsGuestAvatar } from '../../lib/guestAvatarPaths';
import { isOpenPublicShare } from '../../lib/notePublicAccess';
import { verifyShareFileToken } from '../../lib/shareFileToken';
import { noteHasSharePassword } from '../../lib/sharePassword';

const router = express.Router();

/**
 * Stable delivery URL. The database keeps the physical local/S3 path while
 * notes and avatars can keep this provider-neutral URL across migrations.
 */
router.get('/:portableId/file', async (req, res) => {
  const portableId = req.params.portableId;
  const attachment = await prisma.attachments.findUnique({
    where: { portableId },
    include: {
      note: {
        select: {
          isShare: true,
          accountId: true,
          sharePassword: true,
          shareExpiryDate: true,
          shareEncryptedUrl: true,
        },
      },
    },
  });
  if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

  const token = await getTokenFromRequest(req);
  const stablePath = stableAttachmentPath(attachment.portableId);
  const avatar = await prisma.accounts.findFirst({ where: { image: stablePath }, select: { id: true } });
  const noteIsOpenPublic = !!(attachment.note && isOpenPublicShare(attachment.note));
  const shareFileToken = typeof req.query.shareFileToken === 'string' ? req.query.shareFileToken : '';
  const shareTokenOk = !!(attachment.noteId && attachment.note && verifyShareFileToken(shareFileToken, {
    id: attachment.noteId,
    isShare: attachment.note.isShare,
    shareEncryptedUrl: attachment.note.shareEncryptedUrl,
    sharePassword: attachment.note.sharePassword,
    shareExpiryDate: attachment.note.shareExpiryDate,
  }));
  const attachmentPublic = !!attachment.isShare && !(attachment.note && noteHasSharePassword(attachment.note.sharePassword));
  const publiclyReadable = attachmentPublic
    || noteIsOpenPublic
    || !!avatar
    || attachmentIsGuestAvatar(attachment)
    || (!!attachment.noteId && shareTokenOk);
  const owned = !!token && (
    token.role === 'superadmin'
    || attachment.accountId === Number(token.id)
    || attachment.note?.accountId === Number(token.id)
  );
  if (!publiclyReadable && !owned) return res.status(401).json({ error: 'Unauthorized' });

  const query = new URLSearchParams();
  if (req.query.thumbnail === 'true') query.set('thumbnail', 'true');
  if (req.query.download === 'true') query.set('download', 'true');
  // Browser image/audio elements authenticate with the existing same-origin
  // query token because they cannot attach an Authorization header.
  if (typeof req.query.token === 'string') query.set('token', req.query.token);
  if (shareFileToken) query.set('shareFileToken', shareFileToken);
  const suffix = query.size ? `?${query.toString()}` : '';
  res.set('Cache-Control', 'private, no-store');
  return res.redirect(307, `${attachment.path}${suffix}`);
});

export default router;
