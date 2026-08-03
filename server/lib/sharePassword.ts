import { hashPassword, verifyPassword } from '@prisma/seed';

export function isHashedSharePassword(stored: string | null | undefined): boolean {
  return !!stored && stored.startsWith('pbkdf2:');
}

/** Hash a new share password, or return '' when clearing / unset. */
export async function hashSharePassword(password: string | undefined | null): Promise<string> {
  if (!password) return '';
  return hashPassword(password);
}

/**
 * Verify a share password. Supports legacy plaintext values and migrates them
 * to pbkdf2 on successful match when `onUpgrade` is provided.
 */
export async function verifySharePassword(
  input: string | undefined | null,
  stored: string | null | undefined,
  onUpgrade?: (hashed: string) => Promise<void>,
): Promise<boolean> {
  if (!stored) return true;
  if (!input) return false;

  if (isHashedSharePassword(stored)) {
    return verifyPassword(input, stored);
  }

  // Legacy plaintext comparison (constant-time-ish length check then equality).
  if (input.length !== stored.length) return false;
  let mismatch = 0;
  for (let i = 0; i < input.length; i++) {
    mismatch |= input.charCodeAt(i) ^ stored.charCodeAt(i);
  }
  if (mismatch !== 0) return false;

  if (onUpgrade) {
    const hashed = await hashPassword(input);
    await onUpgrade(hashed);
  }
  return true;
}

/** True when the note requires a password to view as a public share. */
export function noteHasSharePassword(stored: string | null | undefined): boolean {
  return !!stored;
}
