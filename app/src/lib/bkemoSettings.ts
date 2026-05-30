/**
 * Lightweight persisted UI preferences for the Direction D surface
 * (theme / accent / density). Stored in localStorage so they survive reloads
 * and apply before first paint. Dark is the default theme.
 */
export type BkemoTheme = 'dark' | 'light';
export type BkemoDensity = 'compact' | 'regular' | 'comfy';

export type BkemoPrefs = {
  theme: BkemoTheme;
  accent: string;
  density: BkemoDensity;
};

const KEY = 'bkemoPrefs';

export const ACCENT_SWATCHES = ['#5E6AD2', '#D97757', '#1F8A5B', '#E2497F', '#0F62FE', '#A45EE0'];

export const DEFAULT_PREFS: BkemoPrefs = {
  theme: 'dark',
  accent: '#5E6AD2',
  density: 'regular',
};

export function loadPrefs(): BkemoPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: BkemoPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}
