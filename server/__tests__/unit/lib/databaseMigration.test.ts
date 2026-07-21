import { describe, expect, test } from 'bun:test';
import { deriveDirectNeonUrl, parsePostgresTarget, sanitizeDatabaseMigrationError } from '../../../lib/databaseMigration';

describe('database migration connection safety', () => {
  test('accepts a complete TLS PostgreSQL URL without exposing the password', () => {
    const target = parsePostgresTarget('postgresql://owner:secret@example.neon.tech/site?sslmode=require');
    expect(target.host).toBe('example.neon.tech');
    expect(target.database).toBe('site');
  });

  test('rejects destinations without required TLS', () => {
    expect(() => parsePostgresTarget('postgresql://owner:secret@example.neon.tech/site')).toThrow('require TLS');
    expect(() => parsePostgresTarget('postgresql://owner:secret@example.neon.tech/site?sslmode=disable')).toThrow('require TLS');
  });

  test('rejects hosted PostgreSQL providers other than Neon', () => {
    expect(() => parsePostgresTarget('postgresql://owner:secret@example.com/site?sslmode=require')).toThrow('Only Neon');
  });

  test('derives and validates the direct endpoint from a Neon pooled URL', () => {
    const direct = new URL(deriveDirectNeonUrl('postgresql://owner:secret@ep-example-pooler.c-2.us-east-1.aws.neon.tech/site?sslmode=require'));
    expect(direct.hostname).toBe('ep-example.c-2.us-east-1.aws.neon.tech');
    expect(() => deriveDirectNeonUrl('postgresql://owner:secret@ep-example.c-2.us-east-1.aws.neon.tech/site?sslmode=require')).toThrow('pooled');
  });

  test('redacts connection strings and Neon-style passwords from errors', () => {
    const message = sanitizeDatabaseMigrationError(new Error('failed postgresql://owner:npg_abc123@example.neon.tech/site?sslmode=require password=npg_more'));
    expect(message).not.toContain('npg_abc123');
    expect(message).not.toContain('npg_more');
    expect(message).toContain('[redacted database URL]');
  });
});
