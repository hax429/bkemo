import { createHmac, timingSafeEqual } from 'crypto';

function signingSecret(): string {
  return process.env.NEXTAUTH_SECRET
    || process.env.JWT_SECRET
    || process.env.SECRET
    || 'bkemo-share-file-dev-secret';
}

type ShareFileTokenPayload = {
  noteId: number;
  exp: number;
  shareEncryptedUrl: string;
  sig: string;
};

/** Mint a short-lived token that authorizes reading attachments for a passworded share. */
export function mintShareFileToken(
  noteId: number,
  shareEncryptedUrl: string,
  ttlSec = 60 * 60,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${noteId}.${exp}.${shareEncryptedUrl}`;
  const sig = createHmac('sha256', signingSecret()).update(payload).digest('base64url');
  const body: ShareFileTokenPayload = { noteId, exp, shareEncryptedUrl, sig };
  return Buffer.from(JSON.stringify(body)).toString('base64url');
}

export function verifyShareFileToken(token: string | undefined | null, noteId: number): boolean {
  if (!token || typeof token !== 'string') return false;
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const data = JSON.parse(raw) as ShareFileTokenPayload;
    if (data.noteId !== noteId) return false;
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return false;
    if (!data.shareEncryptedUrl || !data.sig) return false;
    const payload = `${data.noteId}.${data.exp}.${data.shareEncryptedUrl}`;
    const expected = createHmac('sha256', signingSecret()).update(payload).digest('base64url');
    const a = Buffer.from(data.sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function appendShareFileToken(path: string, token: string): string {
  if (!path || !token) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}shareFileToken=${encodeURIComponent(token)}`;
}
