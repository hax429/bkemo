import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import type { TokenData } from '@/components/Auth/auth-client';
import { isInTauri, isMacOS } from '@/lib/tauriHelper';
import { sessionFromStoredProfile } from '@/lib/nativeSessionCache';

const LEGACY_TOKEN_KEY = 'blinkoToken';
const SESSION_PROFILE_KEY = 'bkemoSessionProfile';

function legacyTokenData(): TokenData | null {
  try {
    const raw = localStorage.getItem(LEGACY_TOKEN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function persistNativeSession(tokenData: TokenData | null, notify = true): Promise<void> {
  if (!isInTauri() || !isMacOS() || !tokenData?.token) return;
  await invoke('save_session_token', { token: tokenData.token });
  localStorage.setItem(SESSION_PROFILE_KEY, JSON.stringify({
    user: tokenData.user,
    expires: tokenData.expires,
  }));
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  if (notify) await emit('native-session-changed');
}

export async function clearNativeSession(notify = true): Promise<void> {
  if (!isInTauri() || !isMacOS()) return;
  await invoke('clear_session_token');
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  localStorage.removeItem(SESSION_PROFILE_KEY);
  if (notify) await emit('native-session-changed');
}

export async function bootstrapNativeSession(): Promise<TokenData | null> {
  if (!isInTauri() || !isMacOS()) return null;

  localStorage.removeItem('password');
  const legacy = legacyTokenData();
  let token = legacy?.token ?? null;

  if (token) {
    await invoke('save_session_token', { token });
    if (legacy?.user) {
      localStorage.setItem(SESSION_PROFILE_KEY, JSON.stringify({
        user: legacy.user,
        expires: legacy.expires,
      }));
    }
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } else {
    token = await invoke<string | null>('load_session_token');
  }

  if (!token) return null;
  return sessionFromStoredProfile(token, localStorage.getItem(SESSION_PROFILE_KEY));
}
