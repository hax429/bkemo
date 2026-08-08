import type { AccessScope } from '../../shared/lib/accessTokenScopes';
import { NoteType } from '../../shared/lib/types';

/** Fixed production origin for Obsidian source links and Open in bkemo. */
export const BKEMO_PUBLIC_ORIGIN = 'https://bk.hax429.me';

export const OBSIDIAN_SCOPES: AccessScope[] = [
  'notes:read',
  'notes:write',
  'tags:read',
  'attachments:read',
  'attachments:write',
];

/** Minimum scope required to connect the Obsidian companion. */
export const OBSIDIAN_REQUIRED_SCOPE: AccessScope = 'notes:read';

export function scopesForObsidian(scopes: string[]): AccessScope[] {
  if (scopes.includes('app:full')) return [...OBSIDIAN_SCOPES];
  const allowed = new Set<AccessScope>(OBSIDIAN_SCOPES);
  return scopes.filter((scope): scope is AccessScope => allowed.has(scope as AccessScope));
}

export function hasObsidianConnectAccess(scopes: AccessScope[]): boolean {
  return scopes.includes(OBSIDIAN_REQUIRED_SCOPE);
}

/** JWT access tokens are three base64url segments; pairing codes are XXXX-XXXX. */
export function looksLikeAccessToken(raw: string): boolean {
  const value = raw.trim();
  if (!value || value.includes(' ')) return false;
  const parts = value.split('.');
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
export const DEVICE_CREDENTIAL_TTL_MS = 365 * 24 * 60 * 60 * 1000;
/** Crockford-ish alphabet without 0/O/1/I to reduce transcription mistakes. */
export const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

export const AUDIO_MAX_BYTES = 25 * 1024 * 1024;
export const AUDIO_MAX_DURATION_SECONDS = 15 * 60;
export const AUDIO_ALLOWED_MIME = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/x-wav',
  'audio/mp3',
]);

export type ObsidianSearchFilter = {
  query?: string;
  tag?: string;
  tasksOnly?: boolean;
  archived?: 'exclude' | 'only' | 'include';
  limit?: number;
  cursor?: string | null;
};

export type NormalizedObsidianSearch = {
  query: string;
  tag: string | null;
  tasksOnly: boolean;
  archived: 'exclude' | 'only' | 'include';
  limit: number;
  cursorUpdatedAt: Date | null;
  cursorPortableId: string | null;
};

export type IntegrationErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'revision_conflict'
  | 'invalid_idempotency_key'
  | 'invalid_pairing_code'
  | 'pairing_code_expired'
  | 'pairing_code_used'
  | 'invalid_access_token'
  | 'access_token_expired'
  | 'access_token_revoked'
  | 'invalid_media'
  | 'oversized_media'
  | 'invalid_duration'
  | 'transcription_unavailable'
  | 'offline'
  | 'invalid_request'
  | 'internal';

const READ_LIMIT = 100;

export function noteSourcePath(portableId: string): string {
  return `/note/${portableId}`;
}

export function noteSourceUrl(portableId: string, origin = BKEMO_PUBLIC_ORIGIN): string {
  return `${origin.replace(/\/+$/, '')}${noteSourcePath(portableId)}`;
}

export function normalizePairingCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidPairingCodeFormat(code: string): boolean {
  return PAIRING_CODE_PATTERN.test(normalizePairingCode(code));
}

/** Human-enterable pairing code: XXXX-XXXX from Crockford-ish alphabet (no 0/O/1/I). */
export function formatPairingCode(bytes: Buffer): string {
  let out = '';
  for (let i = 0; i < 8; i += 1) {
    out += PAIRING_CODE_ALPHABET[bytes[i]! % PAIRING_CODE_ALPHABET.length];
    if (i === 3) out += '-';
  }
  return out;
}

export function normalizeObsidianSearch(input: ObsidianSearchFilter): NormalizedObsidianSearch {
  const archived = input.archived === 'only' || input.archived === 'include' ? input.archived : 'exclude';
  const limit = Math.min(READ_LIMIT, Math.max(1, input.limit || 30));
  let cursorUpdatedAt: Date | null = null;
  let cursorPortableId: string | null = null;
  if (input.cursor?.trim()) {
    const [updatedAtRaw, portableId] = input.cursor.split('|');
    const updatedAt = updatedAtRaw ? new Date(updatedAtRaw) : null;
    if (updatedAt && !Number.isNaN(updatedAt.getTime()) && portableId && /^[0-9a-f-]{36}$/i.test(portableId)) {
      cursorUpdatedAt = updatedAt;
      cursorPortableId = portableId;
    }
  }
  return {
    query: input.query?.trim() || '',
    tag: input.tag?.trim().replace(/^#/, '') || null,
    tasksOnly: !!input.tasksOnly,
    archived,
    limit,
    cursorUpdatedAt,
    cursorPortableId,
  };
}

export function encodeObsidianSearchCursor(updatedAt: Date | string, portableId: string): string {
  const iso = typeof updatedAt === 'string' ? updatedAt : updatedAt.toISOString();
  return `${iso}|${portableId}`;
}

export function validateAudioUpload(input: {
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number | null;
}): IntegrationErrorCode | null {
  const mime = input.mimeType.split(';')[0]?.trim().toLowerCase() || '';
  if (!AUDIO_ALLOWED_MIME.has(mime)) return 'invalid_media';
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) return 'invalid_media';
  if (input.sizeBytes > AUDIO_MAX_BYTES) return 'oversized_media';
  if (input.durationSeconds != null) {
    if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) return 'invalid_duration';
    if (input.durationSeconds > AUDIO_MAX_DURATION_SECONDS) return 'invalid_duration';
  }
  return null;
}

export function sanitizeAttachmentDisplayName(name: string): string {
  const cleaned = name
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return cleaned || 'attachment';
}

export function redactIntegrationError(code: string, message?: string): { code: IntegrationErrorCode; message: string } {
  const known: Record<IntegrationErrorCode, string> = {
    unauthorized: 'Authentication required',
    forbidden: 'Missing permission for this operation',
    not_found: 'Resource not found',
    revision_conflict: 'The note changed after it was read',
    invalid_idempotency_key: 'Idempotency key must be 8-128 safe characters',
    invalid_pairing_code: 'Pairing code is invalid',
    pairing_code_expired: 'Pairing code has expired',
    pairing_code_used: 'Pairing code was already used',
    invalid_access_token: 'Access token is invalid or was not issued by this bkemo instance',
    access_token_expired: 'Access token has expired — create a new one in Settings → Security',
    access_token_revoked: 'Access token was revoked',
    invalid_media: 'Audio type is not supported',
    oversized_media: 'Audio exceeds the size limit',
    invalid_duration: 'Audio duration is invalid or too long',
    transcription_unavailable: 'Transcription is temporarily unavailable',
    offline: 'bkemo is unreachable',
    invalid_request: 'Request is invalid',
    internal: 'Unexpected server error',
  };
  const normalized = (Object.keys(known) as IntegrationErrorCode[]).includes(code as IntegrationErrorCode)
    ? (code as IntegrationErrorCode)
    : 'internal';
  // Prefer the curated message; never echo raw upstream text that may contain secrets.
  return { code: normalized, message: known[normalized] || known.internal };
}

export function taskFilterClause(tasksOnly: boolean) {
  if (!tasksOnly) return {};
  return {
    OR: [{ type: NoteType.TODO }, { dueDate: { not: null } }],
  };
}

/** Device / access credentials stop resolving once revoked or past expiry. */
export function isCredentialTimeValid(
  input: { revokedAt?: Date | null; expiresAt?: Date | null },
  now = new Date(),
): boolean {
  if (input.revokedAt) return false;
  if (input.expiresAt && input.expiresAt <= now) return false;
  return true;
}

/** Every Obsidian note/attachment read is scoped to the actor account. */
export function ownedPortableWhere(accountId: number, portableId: string) {
  return { portableId, accountId };
}

/** Conditional writes treat updateMany count !== 1 as a revision conflict. */
export function revisionWriteMatched(updatedCount: number): boolean {
  return updatedCount === 1;
}
