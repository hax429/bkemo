import { describe, expect, test } from 'bun:test';
import { verifyActiveSetup } from '../../../lib/activeSetupVerification';

describe('active setup verification', () => {
  test('reports independent healthy Neon and R2 checks without exposing the full host', async () => {
    const result = await verifyActiveSetup({
      databaseUrl: 'postgresql://owner:secret@ep-fancy-bread-pooler.c-10.us-east-1.aws.neon.tech/neondb?sslmode=require',
      async queryDatabase() { return { database: 'neondb' }; },
      async loadStorageSettings() {
        return { provider: 's3', endpoint: 'https://account.r2.cloudflarestorage.com', region: 'auto', bucket: 'bkemo-dev', prefix: 'attachments' };
      },
      async testStorage() {
        return { ok: true, provider: 's3', message: 'S3 write, read and delete checks passed', location: 's3://bkemo-dev/attachments' };
      },
    });

    expect(result.ok).toBe(true);
    expect(result.database).toMatchObject({ ok: true, provider: 'neon', pooled: true, database: 'neondb' });
    expect(result.database.host).not.toContain('fancy-bread');
    expect(result.attachments).toMatchObject({ ok: true, provider: 's3', location: 's3://bkemo-dev/attachments' });
  });

  test('preserves a successful database result when attachment verification fails', async () => {
    const result = await verifyActiveSetup({
      databaseUrl: 'postgresql://postgres:secret@localhost:5433/bkemo',
      async queryDatabase() { return { database: 'bkemo' }; },
      async loadStorageSettings() { return { provider: 'local' }; },
      async testStorage() { throw new Error('folder is read-only'); },
    });

    expect(result.ok).toBe(false);
    expect(result.database.ok).toBe(true);
    expect(result.attachments).toMatchObject({ ok: false, provider: 'local', message: 'folder is read-only' });
  });

  test('times out each service independently', async () => {
    const never = () => new Promise<never>(() => {});
    const result = await verifyActiveSetup({
      databaseUrl: 'postgresql://postgres:secret@localhost:5433/bkemo',
      queryDatabase: never,
      async loadStorageSettings() { return { provider: 'local' }; },
      testStorage: never,
      timeoutMs: 5,
    });

    expect(result.ok).toBe(false);
    expect(result.database.message).toContain('timed out');
    expect(result.attachments.message).toContain('timed out');
  });
});
