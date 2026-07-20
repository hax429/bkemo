import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'crypto';
import { decryptBkPayloadWithSiteKey, encryptBkPayloadWithSiteKey } from '../../../lib/bkemoTransfer';

describe('.bk double encryption', () => {
  test('requires both the passphrase and the originating site key', async () => {
    const siteKey = randomBytes(32);
    const payload = Buffer.from('private bkemo data');
    const encrypted = await encryptBkPayloadWithSiteKey(payload, 'correct horse battery staple', 'site-a1b2', siteKey);

    expect(encrypted.includes(payload)).toBe(false);
    expect((await decryptBkPayloadWithSiteKey(encrypted, 'correct horse battery staple', siteKey)).plain).toEqual(payload);
    await expect(decryptBkPayloadWithSiteKey(encrypted, 'wrong passphrase', siteKey)).rejects.toThrow();
    await expect(decryptBkPayloadWithSiteKey(encrypted, 'correct horse battery staple', randomBytes(32))).rejects.toThrow(/recovery key/i);
  });

  test('rejects passphrases shorter than eight characters', async () => {
    await expect(encryptBkPayloadWithSiteKey(Buffer.from('x'), 'short', 'site-a1b2', randomBytes(32))).rejects.toThrow(/8 characters/i);
  });
});
