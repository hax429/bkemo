import { writeFile, readFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { isInTauri } from './tauriHelper';
import { getBlinkoEndpoint } from './blinkoEndpoint';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';

const CACHE_INDEX_KEY = 'cachedAttachments';

type CacheIndex = Record<string, string>;

function readIndex(): CacheIndex {
  try {
    return JSON.parse(localStorage.getItem(CACHE_INDEX_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeIndex(index: CacheIndex) {
  localStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(index));
}

export async function cacheAttachment(remotePath: string): Promise<string> {
  if (!isInTauri()) return getBlinkoEndpoint(remotePath);

  const index = readIndex();
  if (index[remotePath]) return index[remotePath];

  const token = RootStore.Get(UserStore).tokenData.value?.token;
  const fetchUrl = getBlinkoEndpoint(remotePath) + (token ? `?token=${token}` : '');

  const res = await fetch(fetchUrl);
  if (!res.ok) throw new Error(`Failed to cache ${remotePath}: ${res.status}`);

  const buffer = await res.arrayBuffer();
  const filename = remotePath.split('/').pop() ?? 'file';
  const cacheFilename = `cache_${Date.now()}_${filename}`;

  await writeFile(cacheFilename, new Uint8Array(buffer), { baseDir: BaseDirectory.AppCache });

  index[remotePath] = cacheFilename;
  writeIndex(index);
  return cacheFilename;
}

export function getCachedPath(remotePath: string): string | null {
  return readIndex()[remotePath] ?? null;
}

export function clearAttachmentCache(): void {
  localStorage.removeItem(CACHE_INDEX_KEY);
}
