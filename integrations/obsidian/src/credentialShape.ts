export function looksLikeAccessToken(raw: string): boolean {
  const value = raw.trim();
  if (!value || value.includes(' ')) return false;
  const parts = value.split('.');
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

export function looksLikePairingCode(raw: string): boolean {
  return /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/.test(raw.trim());
}
