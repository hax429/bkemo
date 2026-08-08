const STORAGE_KEY = 'bkemo.auth.returnTo';

/** Same-origin relative paths only; blocks open redirects (`//evil`). */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value) return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

export function stashAuthReturnTo(value: string | null | undefined): void {
  const returnTo = safeReturnTo(value);
  try {
    if (returnTo === '/') sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, returnTo);
  } catch {
    // sessionStorage may be unavailable in private mode / native shells
  }
}

/** Read and clear a previously stashed post-SSO destination. */
export function consumeAuthReturnTo(): string {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    return safeReturnTo(stored);
  } catch {
    return '/';
  }
}
