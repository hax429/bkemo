import { describe, expect, test } from 'bun:test';
import {
  assertDevelopmentNeonAttachAllowed,
  replaceDatabaseUrl,
  validateExistingNeonSchema,
} from '../../../lib/developmentNeonAttach';

describe('development-only existing Neon attach', () => {
  test('production rejects the override even when the flag is set', () => {
    expect(() => assertDevelopmentNeonAttachAllowed({
      nodeEnv: 'production',
      allowExisting: 'true',
      consumed: false,
    })).toThrow('unavailable in production');
  });

  test('requires an explicit unused local approval', () => {
    expect(() => assertDevelopmentNeonAttachAllowed({ nodeEnv: 'development', allowExisting: '', consumed: false })).toThrow('not enabled');
    expect(() => assertDevelopmentNeonAttachAllowed({ nodeEnv: 'development', allowExisting: 'true', consumed: true })).toThrow('already been used');
    expect(() => assertDevelopmentNeonAttachAllowed({ nodeEnv: 'development', allowExisting: 'true', consumed: false })).not.toThrow();
  });

  test('accepts a compatible non-empty bkemo schema and rejects unrelated databases', () => {
    expect(validateExistingNeonSchema(['accounts', 'attachments', 'config', 'notes', '_prisma_migrations'])).toEqual({ tableCount: 5 });
    expect(() => validateExistingNeonSchema([])).toThrow('must already contain');
    expect(() => validateExistingNeonSchema(['accounts', 'notes'])).toThrow('not a compatible bkemo database');
  });

  test('updates only DATABASE_URL and preserves the rest of the local environment', () => {
    const next = replaceDatabaseUrl('NODE_ENV=development\nDATABASE_URL=postgresql://old\nNEXTAUTH_URL=http://localhost:1111\n', 'postgresql://owner:secret@example-pooler.neon.tech/site?sslmode=require');
    expect(next).toContain('NODE_ENV=development');
    expect(next).toContain('DATABASE_URL="postgresql://owner:secret@example-pooler.neon.tech/site?sslmode=require"');
    expect(next).toContain('NEXTAUTH_URL=http://localhost:1111');
    expect(next).not.toContain('postgresql://old');
  });
});
