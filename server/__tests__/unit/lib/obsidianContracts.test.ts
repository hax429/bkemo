import { describe, expect, test } from 'bun:test';
import {
  encodeObsidianSearchCursor,
  formatPairingCode,
  hasObsidianConnectAccess,
  isValidPairingCodeFormat,
  looksLikeAccessToken,
  normalizeObsidianSearch,
  normalizePairingCode,
  noteSourceUrl,
  redactIntegrationError,
  sanitizeAttachmentDisplayName,
  scopesForObsidian,
  validateAudioUpload,
} from '../../../lib/obsidianContracts';

describe('obsidianContracts', () => {
  test('formats and validates pairing codes', () => {
    const code = formatPairingCode(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(isValidPairingCodeFormat(code)).toBe(true);
    expect(isValidPairingCodeFormat(code.toLowerCase())).toBe(true);
    expect(normalizePairingCode(` ${code.toLowerCase()} `)).toBe(code);
    expect(isValidPairingCodeFormat('AAAA-AAA')).toBe(false);
    expect(isValidPairingCodeFormat('AAAA-AAO1')).toBe(false);
  });

  test('builds portable note source URLs', () => {
    const portableId = '67b2d411-221e-4dbe-98a4-d6db7c98c793';
    expect(noteSourceUrl(portableId)).toBe(`https://bk.hax429.me/note/${portableId}`);
    expect(noteSourceUrl(portableId, 'http://localhost:1111/')).toBe(`http://localhost:1111/note/${portableId}`);
  });

  test('normalizes sidebar search filters and cursors', () => {
    const page = normalizeObsidianSearch({
      query: '  report  ',
      tag: '#work',
      tasksOnly: true,
      archived: 'only',
      limit: 999,
      cursor: '2026-08-01T08:00:00.000Z|67b2d411-221e-4dbe-98a4-d6db7c98c793',
    });
    expect(page.query).toBe('report');
    expect(page.tag).toBe('work');
    expect(page.tasksOnly).toBe(true);
    expect(page.archived).toBe('only');
    expect(page.limit).toBe(100);
    expect(page.cursorPortableId).toBe('67b2d411-221e-4dbe-98a4-d6db7c98c793');
    expect(encodeObsidianSearchCursor(page.cursorUpdatedAt!, page.cursorPortableId!)).toContain('|67b2d411');
  });

  test('rejects invalid or oversized audio uploads', () => {
    expect(validateAudioUpload({ mimeType: 'audio/webm', sizeBytes: 1024, durationSeconds: 12 })).toBeNull();
    expect(validateAudioUpload({ mimeType: 'video/mp4', sizeBytes: 1024 })).toBe('invalid_media');
    expect(validateAudioUpload({ mimeType: 'audio/webm', sizeBytes: 26 * 1024 * 1024 })).toBe('oversized_media');
    expect(validateAudioUpload({ mimeType: 'audio/webm', sizeBytes: 1024, durationSeconds: 20 * 60 })).toBe('invalid_duration');
  });

  test('sanitizes attachment names and redacts errors', () => {
    expect(sanitizeAttachmentDisplayName('../evil\\name?.webm')).toBe('.._evil_name_.webm');
    expect(redactIntegrationError('revision_conflict', 'secret note body')).toEqual({
      code: 'revision_conflict',
      message: 'The note changed after it was read',
    });
    expect(redactIntegrationError('weird', 'token=abc')).toEqual({
      code: 'internal',
      message: 'Unexpected server error',
    });
    expect(redactIntegrationError('invalid_access_token').code).toBe('invalid_access_token');
    expect(redactIntegrationError('access_token_expired').message).toContain('expired');
  });

  test('intersects access-token scopes for Obsidian connect', () => {
    expect(scopesForObsidian(['notes:read', 'analytics:read', 'tags:read'])).toEqual(['notes:read', 'tags:read']);
    expect(hasObsidianConnectAccess(['notes:read'])).toBe(true);
    expect(hasObsidianConnectAccess(['tags:read'])).toBe(false);
    expect(looksLikeAccessToken('aaaa.bbbb.cccc')).toBe(true);
    expect(looksLikeAccessToken('ABCD-EFGH')).toBe(false);
  });
});
