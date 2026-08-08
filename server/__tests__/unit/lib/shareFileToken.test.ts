import { afterEach, describe, expect, test } from 'bun:test';
import { appendShareFileToken, mintShareFileToken, verifyShareFileToken } from '../../../lib/shareFileToken';

const activeNote = {
  id: 42,
  isShare: true,
  shareEncryptedUrl: 'site-abc',
  sharePassword: 'pbkdf2$v1$hash',
  shareExpiryDate: null as Date | null,
};

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  SHARE_FILE_TOKEN_SECRET: process.env.SHARE_FILE_TOKEN_SECRET,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
  JWT_SECRET: process.env.JWT_SECRET,
  SECRET: process.env.SECRET,
};

afterEach(() => {
  process.env.NODE_ENV = originalEnv.NODE_ENV;
  for (const key of ['SHARE_FILE_TOKEN_SECRET', 'NEXTAUTH_SECRET', 'JWT_SECRET', 'SECRET'] as const) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('shareFileToken', () => {
  test('mints and verifies for the same note share state', () => {
    process.env.JWT_SECRET = 'test-jwt-secret';
    const token = mintShareFileToken(42, 'site-abc', activeNote.sharePassword);
    expect(verifyShareFileToken(token, activeNote)).toBe(true);
    expect(verifyShareFileToken(token, { ...activeNote, id: 99 })).toBe(false);
    expect(verifyShareFileToken('garbage', activeNote)).toBe(false);
  });

  test('rejects after share cancel, link rotate, password change, or expiry', () => {
    process.env.JWT_SECRET = 'test-jwt-secret';
    const token = mintShareFileToken(42, 'site-abc', activeNote.sharePassword);

    expect(verifyShareFileToken(token, { ...activeNote, isShare: false })).toBe(false);
    expect(verifyShareFileToken(token, { ...activeNote, shareEncryptedUrl: null })).toBe(false);
    expect(verifyShareFileToken(token, { ...activeNote, shareEncryptedUrl: 'rotated' })).toBe(false);
    expect(verifyShareFileToken(token, { ...activeNote, sharePassword: 'pbkdf2$v1$other' })).toBe(false);
    expect(verifyShareFileToken(token, {
      ...activeNote,
      shareExpiryDate: new Date(Date.now() - 1000),
    })).toBe(false);
  });

  test('fails closed in production without a configured secret', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SHARE_FILE_TOKEN_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.JWT_SECRET;
    delete process.env.SECRET;

    expect(() => mintShareFileToken(42, 'site-abc', 'pw')).toThrow(/JWT_SECRET|SHARE_FILE_TOKEN_SECRET/);
    expect(verifyShareFileToken('anything', activeNote)).toBe(false);
  });

  test('allows the local-dev fallback secret outside production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.SHARE_FILE_TOKEN_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.JWT_SECRET;
    delete process.env.SECRET;

    const token = mintShareFileToken(42, 'site-abc', activeNote.sharePassword);
    expect(verifyShareFileToken(token, activeNote)).toBe(true);
  });

  test('appends token as query param', () => {
    expect(appendShareFileToken('/api/file/x.png', 'tok')).toBe('/api/file/x.png?shareFileToken=tok');
    expect(appendShareFileToken('/api/file/x.png?thumbnail=true', 'tok')).toBe(
      '/api/file/x.png?thumbnail=true&shareFileToken=tok',
    );
  });
});
