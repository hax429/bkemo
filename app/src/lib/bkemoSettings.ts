/**
 * Lightweight persisted UI preferences for the bkemo surface
 * (theme / accent / density). localStorage is the synchronous pre-paint cache /
 * offline fallback; the server (per-user config) is authoritative.
 */
import { api } from '@/lib/trpc';

export type BkemoTheme = 'dark' | 'light';
export type BkemoDensity = 'compact' | 'regular' | 'comfy';

export const MOBILE_TOOL_OPTIONS: { id: 'graph' | 'calendar' | 'files' | 'matrix' | 'week' | 'analytics' | 'ai'; label: string; glyph: string }[] = [
  { id: 'graph', label: 'Graph', glyph: '⊚' },
  { id: 'calendar', label: 'Calendar', glyph: '▦' },
  { id: 'files', label: 'Files', glyph: '◳' },
  { id: 'matrix', label: 'Matrix', glyph: '⊞' },
  { id: 'week', label: 'This week', glyph: '▦' },
  { id: 'analytics', label: 'Analytics', glyph: '▥' },
  { id: 'ai', label: 'AI', glyph: '✧' },
];

export type BkemoPrefs = {
  theme: BkemoTheme;
  accent: string;
  density: BkemoDensity;
  bgGradient?: 'none' | 'dusk' | 'warm' | 'aurora';
  /** Graph view: include notes with no `[[ ]]` links (isolated nodes), not just the link graph. */
  graphShowAll?: boolean;
  /** Native app: schedule local OS notifications for tasks at their due time. */
  taskReminders?: boolean;
};

export type BkemoPreset = {
  key: string;
  name: string;
  theme: BkemoTheme;
  accent: string;
  density: BkemoDensity;
  font: string;
  description: string;
  bgGradient?: 'none' | 'dusk' | 'warm' | 'aurora';
};

const KEY = 'bkemoPrefs';

export const ACCENT_SWATCHES = [
  '#e2a96b', // Honey / Warm Amber (Default Coffee Latte)
  '#5E6AD2', // Default Developer (Issue Blue)
  '#D97757', // Warm Orange / Rust
  '#1F8A5B', // Emerald / Green
  '#E2497F', // Pink / Rose
  '#0F62FE', // Blue / Indigo
  '#A45EE0', // Purple / Lavender
  '#9C6644', // Coffee / Brown
  '#0E7490', // Teal / Cyan
];

export const PRESET_THEMES: BkemoPreset[] = [
  {
    key: 'coffee',
    name: 'Coffee Latte',
    theme: 'dark',
    accent: '#e2a96b',
    density: 'regular',
    font: 'Outfit',
    bgGradient: 'warm',
    description: 'Earthy espresso tones paired with warm honey accents and Outfit typography.',
  },
  {
    key: 'developer',
    name: 'Developer Dark',
    theme: 'dark',
    accent: '#5E6AD2',
    density: 'regular',
    font: 'default',
    bgGradient: 'none',
    description: 'Cold, clinical developer dark mode built for efficiency and focus.',
  },
];

export const DEFAULT_PREFS: BkemoPrefs = {
  theme: 'dark',
  accent: '#e2a96b',
  density: 'regular',
  bgGradient: 'dusk',
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
