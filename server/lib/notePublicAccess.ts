import { noteHasSharePassword } from './sharePassword';

/** Guest-visible without a share password (and not expired). */
export function isOpenPublicShare(note: {
  isShare: boolean;
  sharePassword: string | null;
  shareExpiryDate: Date | null;
}): boolean {
  if (!note.isShare) return false;
  if (noteHasSharePassword(note.sharePassword)) return false;
  if (note.shareExpiryDate && note.shareExpiryDate <= new Date()) return false;
  return true;
}
