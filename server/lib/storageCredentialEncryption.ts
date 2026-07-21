import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const PREFIX = 'bkemo-secret:v1:';

function encryptionKey() {
  const secret = process.env.BKEMO_CONFIG_ENCRYPTION_KEY || process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('Set BKEMO_CONFIG_ENCRYPTION_KEY or JWT_SECRET before saving S3 credentials');
  return createHash('sha256').update(secret).digest();
}

export function encryptStorageCredential(value: string) {
  if (!value || value.startsWith(PREFIX)) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptStorageCredential(value: unknown) {
  const stored = String(value ?? '');
  if (!stored || !stored.startsWith(PREFIX)) return stored;
  const [ivValue, tagValue, encryptedValue] = stored.slice(PREFIX.length).split(':');
  if (!ivValue || !tagValue || !encryptedValue) throw new Error('Saved S3 credential is corrupted');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8');
}
