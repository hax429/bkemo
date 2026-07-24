import { DEFAULT_SHARE_IMAGE_OPTIONS, type ShareImageOptions } from './types';

const KEY = 'bkemo.shareImagePrefs';

export function loadShareImagePrefs(): ShareImageOptions {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SHARE_IMAGE_OPTIONS };
    return { ...DEFAULT_SHARE_IMAGE_OPTIONS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SHARE_IMAGE_OPTIONS };
  }
}

export function saveShareImagePrefs(opts: ShareImageOptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(opts));
  } catch {
    /* ignore */
  }
}
