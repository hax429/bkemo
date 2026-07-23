import type { TokenData } from '@/components/Auth/auth-client';

export function sessionFromStoredProfile(token: string, cachedProfile: string | null): TokenData {
  if (!cachedProfile) return { token };
  try {
    return { ...JSON.parse(cachedProfile), token };
  } catch {
    return { token };
  }
}
