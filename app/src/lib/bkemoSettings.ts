/**
 * Lightweight persisted UI preferences for the Direction D surface
 * (theme / accent / density). localStorage is the synchronous pre-paint cache /
 * offline fallback; the server (per-user config) is authoritative.
 */
import { api } from '@/lib/trpc';

export type BkemoTheme = 'dark' | 'light';
export type BkemoDensity = 'compact' | 'regular' | 'comfy';

export type BkemoPrefs = {
  theme: BkemoTheme;
  accent: string;
  density: BkemoDensity;
};

export type BkemoPreset = {
  key: string;
  name: string;
  theme: BkemoTheme;
  accent: string;
  density: BkemoDensity;
  font: string;
  description: string;
};

const KEY = 'bkemoPrefs';

export const ACCENT_SWATCHES = [
  '#5E6AD2', // Default (Issue Blue)
  '#D97757', // Warm Orange / Rust
  '#1F8A5B', // Emerald / Green
  '#E2497F', // Pink / Rose
  '#0F62FE', // Blue / Indigo
  '#A45EE0', // Purple / Lavender
  '#9C6644', // Coffee / Brown
  '#D9A74A', // Amber / Gold
  '#0E7490', // Teal / Cyan
];

export const PRESET_THEMES: BkemoPreset[] = [
  {
    key: 'default',
    name: 'Default Dark',
    theme: 'dark',
    accent: '#5E6AD2',
    density: 'regular',
    font: 'default',
    description: 'The standard space dark layout with sleek purple-blue accents.',
  },
  {
    key: 'warm',
    name: 'Warm Sunset',
    theme: 'dark',
    accent: '#D97757',
    density: 'regular',
    font: 'Poppins',
    description: 'A cozy dark theme with warm rust accents and Poppins typography.',
  },
  {
    key: 'efficient',
    name: 'Efficient Dev',
    theme: 'dark',
    accent: '#0F62FE',
    density: 'compact',
    font: 'JetBrains Mono',
    description: 'High-density compact layout with blue accents and developer font.',
  },
  {
    key: 'coffee',
    name: 'Coffee Latte',
    theme: 'dark',
    accent: '#9C6644',
    density: 'regular',
    font: 'Outfit',
    description: 'Earthy brown tones paired with modern Outfit sans-serif typeface.',
  },
  {
    key: 'nordic',
    name: 'Nordic Light',
    theme: 'light',
    accent: '#0E7490',
    density: 'regular',
    font: 'Inter',
    description: 'Crisp light interface with cool teal accents and clean Inter text.',
  },
  {
    key: 'terminal',
    name: 'Hacker Terminal',
    theme: 'dark',
    accent: '#1F8A5B',
    density: 'compact',
    font: 'Roboto Mono',
    description: 'Retro green terminal mode with compact monospaced text.',
  },
];

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

/** Write to localStorage AND fire-and-forget to the server config. */
export function savePrefs(prefs: BkemoPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  // Persist to per-user server config so appearance follows the account.
  try {
    api.config.update.mutate({ key: 'bkemoPrefs' as any, value: prefs }).catch(() => { /* silent */ });
  } catch { /* ignore — may fire before trpc client is ready */ }
}

/** Hydrate localStorage from a server-sourced prefs object and return merged. */
export function hydratePrefs(serverPrefs: Partial<BkemoPrefs>): BkemoPrefs {
  const merged = { ...DEFAULT_PREFS, ...serverPrefs };
  try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch { /* ignore */ }
  return merged;
}
