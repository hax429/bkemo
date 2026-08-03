import { describe, expect, test } from 'bun:test';
import { hashSharePassword, isHashedSharePassword, noteHasSharePassword, verifySharePassword } from '../../../lib/sharePassword';

describe('sharePassword', () => {
  test('hashes and verifies new passwords', async () => {
    const hashed = await hashSharePassword('secret');
    expect(isHashedSharePassword(hashed)).toBe(true);
    expect(noteHasSharePassword(hashed)).toBe(true);
    expect(await verifySharePassword('secret', hashed)).toBe(true);
    expect(await verifySharePassword('wrong', hashed)).toBe(false);
  });

  test('supports legacy plaintext and upgrades', async () => {
    let upgraded: string | undefined;
    const ok = await verifySharePassword('legacy', 'legacy', async (hashed) => {
      upgraded = hashed;
    });
    expect(ok).toBe(true);
    expect(upgraded && isHashedSharePassword(upgraded)).toBe(true);
  });

  test('empty password means no protection', async () => {
    expect(noteHasSharePassword('')).toBe(false);
    expect(await hashSharePassword(undefined)).toBe('');
    expect(await verifySharePassword(undefined, '')).toBe(true);
  });
});
