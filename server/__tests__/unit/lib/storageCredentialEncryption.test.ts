import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { decryptStorageCredential, encryptStorageCredential } from '../../../lib/storageCredentialEncryption';

describe('storage credential encryption', () => {
  const previous = process.env.BKEMO_CONFIG_ENCRYPTION_KEY;

  beforeEach(() => { process.env.BKEMO_CONFIG_ENCRYPTION_KEY = 'unit-test-storage-key'; });
  afterEach(() => {
    if (previous === undefined) delete process.env.BKEMO_CONFIG_ENCRYPTION_KEY;
    else process.env.BKEMO_CONFIG_ENCRYPTION_KEY = previous;
  });

  test('encrypts credentials with authenticated encryption and restores them', () => {
    const encrypted = encryptStorageCredential('r2-secret-value');
    expect(encrypted).not.toContain('r2-secret-value');
    expect(decryptStorageCredential(encrypted)).toBe('r2-secret-value');
  });

  test('keeps legacy plaintext readable for automatic upgrade on the next save', () => {
    expect(decryptStorageCredential('legacy-secret')).toBe('legacy-secret');
  });
});
