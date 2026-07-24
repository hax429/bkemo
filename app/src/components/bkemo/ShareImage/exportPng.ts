import { domToPng } from 'modern-screenshot';
import axiosInstance from '@/lib/axios';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'sync';
    img.onload = () => {
      if (img.naturalWidth > 0) resolve(img);
      else reject(new Error('image has no dimensions'));
    };
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });
}

/**
 * Fetch an image URL into a data: URL.
 * Uses the shared axios client (Bearer token) — window.fetch + credentials
 * fails CORS for Tauri → API host, which is why export thumbs came out broken.
 */
export async function urlToDataUrl(url: string): Promise<string | null> {
  if (!url || url.startsWith('data:')) return url || null;
  try {
    const token = RootStore.Get(UserStore).token;
    const res = await axiosInstance.get<Blob>(url, {
      responseType: 'blob',
      // Token is also often in the query string; header covers paths without it.
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      // Avoid cookie credential CORS mode; auth is bearer / query token.
      withCredentials: false,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    const blob = res.data;
    if (!(blob instanceof Blob)) return null;
    if (blob.type && !blob.type.startsWith('image/') && blob.type !== 'application/octet-stream') {
      console.warn('[share-image] inline non-image content-type', blob.type, url);
      return null;
    }
    const dataUrl = await blobToDataUrl(blob);
    // Reject HTML/JSON error bodies that slipped through as octet-stream
    try {
      await loadImage(dataUrl);
    } catch {
      console.warn('[share-image] inline payload did not decode as image', url);
      return null;
    }
    return dataUrl;
  } catch (e) {
    console.warn('[share-image] failed to inline', url, e);
    return null;
  }
}

async function waitOneImage(img: HTMLImageElement, timeoutMs: number): Promise<boolean> {
  if (img.complete && img.naturalWidth > 0) return true;
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onErr);
      resolve(ok);
    };
    const onLoad = () => done(img.naturalWidth > 0);
    const onErr = () => done(false);
    const timer = window.setTimeout(() => done(img.naturalWidth > 0), timeoutMs);
    img.addEventListener('load', onLoad);
    img.addEventListener('error', onErr);
  });
}

/**
 * Replace every <img> src with an embedded data URL so modern-screenshot
 * does not drop cross-origin / late-decoded attachment thumbnails.
 */
export async function inlineShareImages(root: HTMLElement): Promise<void> {
  const imgs = [...root.querySelectorAll('img')];
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.currentSrc || img.getAttribute('src') || '';
      if (!src || src.startsWith('data:')) return;
      const data = await urlToDataUrl(src);
      if (data) {
        img.removeAttribute('srcset');
        img.alt = '';
        img.src = data;
        await waitOneImage(img, 3000);
      }
    }),
  );
}

/**
 * Paint loaded <img>s onto same-sized <canvas> nodes. modern-screenshot reads
 * canvas pixels via toDataURL and never re-fetches — critical for Tauri/CORS.
 * Always draw from a data: URL so the canvas is not origin-tainted.
 */
export async function rasterizeShareImages(root: HTMLElement): Promise<void> {
  const imgs = [...root.querySelectorAll('img')];
  for (const img of imgs) {
    const src = img.currentSrc || img.getAttribute('src') || '';
    if (!src) continue;

    let data = src.startsWith('data:') ? src : await urlToDataUrl(src);
    if (!data) continue;

    let bitmap: HTMLImageElement;
    try {
      bitmap = await loadImage(data);
    } catch {
      continue;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.naturalWidth;
      canvas.height = bitmap.naturalHeight;
      canvas.className = img.className;
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(bitmap, 0, 0);
      img.replaceWith(canvas);
    } catch (e) {
      console.warn('[share-image] rasterize failed', e);
    }
  }
}

export async function waitForShareImages(root: HTMLElement, timeoutMs = 6000): Promise<void> {
  const imgs = [...root.querySelectorAll('img')];
  if (!imgs.length) return;
  await Promise.race([
    Promise.all(imgs.map((img) => waitOneImage(img, timeoutMs))),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

export async function exportSharePng(el: HTMLElement, scale: number): Promise<string> {
  await inlineShareImages(el);
  await waitForShareImages(el);
  await rasterizeShareImages(el);
  try {
    await document.fonts?.ready;
  } catch {
    /* ignore */
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  // Never export softer than the display pixel ratio when the user picks 1× —
  // still respect explicit 2× / 3×. Cap at 3.
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const effectiveScale = Math.min(3, Math.max(scale, scale < 2 ? Math.max(2, Math.round(dpr)) : scale));

  return domToPng(el, {
    scale: effectiveScale,
    quality: 1,
    backgroundColor: null,
    style: {
      transform: 'none',
      opacity: '1',
      visibility: 'visible',
    },
    fetch: {
      requestInit: {
        credentials: 'omit',
        cache: 'no-cache',
        headers: (() => {
          const token = RootStore.Get(UserStore).token;
          return token ? { Authorization: `Bearer ${token}` } : undefined;
        })(),
      },
      bypassingCache: true,
    },
    fetchFn: async (url) => (await urlToDataUrl(url)) || false,
  });
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function copyDataUrlToClipboard(dataUrl: string): Promise<boolean> {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

export async function nativeShareDataUrl(dataUrl: string, filename: string): Promise<boolean> {
  try {
    if (!navigator.share || !navigator.canShare) return false;
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const file = new File([blob], filename, { type: blob.type || 'image/png' });
    if (!navigator.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file], title: filename });
    return true;
  } catch {
    return false;
  }
}
