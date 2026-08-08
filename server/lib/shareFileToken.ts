import { createHmac, timingSafeEqual } from 'crypto';

const DEV_FALLBACK_SECRET = 'bkemo-share-file-dev-secret';

function configuredSigningSecret(): string | null {
  const secret = process.env.SHARE_FILE_TOKEN_SECRET
    || process.env.NEXTAUTH_SECRET
    || process.env.JWT_SECRET
    || process.env.SECRET;
  return secret && secret.trim() ? secret : null;
}

/** Production refuses the hardcoded fallback; local/dev may use it. */
function signingSecretOrNull(): string | null {
  const configured = configuredSigningSecret();
  if (configured) return configured;
  if (process.env.NODE_ENV !== 'production') return DEV_FALLBACK_SECRET;
  return null;
}

function signingSecret(): string {
  const secret = signingSecretOrNull();
  if (!secret) {
    throw new Error('Set JWT_SECRET (or SHARE_FILE_TOKEN_SECRET) before minting share file tokens');
  }
  return secret;
}

type ShareFileTokenPayload = {
  noteId: number;
  exp: number;
  shareEncryptedUrl: string;
  /** Stored sharePassword value at mint time; password/link rotation invalidates the token. */
  sharePasswordVersion: string;
  sig: string;
};

export type ShareFileTokenNoteState = {
  id: number;
  isShare: boolean;
  shareEncryptedUrl: string | null | undefined;
  sharePassword: string | null | undefined;
  shareExpiryDate?: Date | null;
};

/** Mint a short-lived token that authorizes reading attachments for a passworded share. */
export function mintShareFileToken(
  noteId: number,
  shareEncryptedUrl: string,
  sharePasswordVersion: string,
  ttlSec = 60 * 60,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const passwordVersion = sharePasswordVersion || '';
  const payload = `${noteId}.${exp}.${shareEncryptedUrl}.${passwordVersion}`;
  const sig = createHmac('sha256', signingSecret()).update(payload).digest('base64url');
  const body: ShareFileTokenPayload = {
    noteId,
    exp,
    shareEncryptedUrl,
    sharePasswordVersion: passwordVersion,
    sig,
  };
  return Buffer.from(JSON.stringify(body)).toString('base64url');
}

/**
 * Cryptographically verify a share file token and bind it to the note's current
 * share state so cancel/rotate/password-change revoke access immediately.
 */
export function verifyShareFileToken(
  token: string | undefined | null,
  note: ShareFileTokenNoteState | null | undefined,
): boolean {
  if (!token || typeof token !== 'string' || !note) return false;
  if (!note.isShare) return false;
  if (!note.shareEncryptedUrl) return false;
  if (note.shareExpiryDate && note.shareExpiryDate <= new Date()) return false;

  const secret = signingSecretOrNull();
  if (!secret) return false;

  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const data = JSON.parse(raw) as ShareFileTokenPayload;
    if (data.noteId !== note.id) return false;
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return false;
    if (!data.shareEncryptedUrl || !data.sig) return false;
    if (data.shareEncryptedUrl !== note.shareEncryptedUrl) return false;
    const passwordVersion = data.sharePasswordVersion ?? '';
    if (passwordVersion !== (note.sharePassword || '')) return false;
    const payload = `${data.noteId}.${data.exp}.${data.shareEncryptedUrl}.${passwordVersion}`;
    const expected = createHmac('sha256', secret).update(payload).digest('base64url');
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
