import path from 'node:path';

const APP_SHELL_FILES = new Set([
  'index.html',
  'sw.js',
  'registerSW.js',
  'manifest.json',
  'manifest.webmanifest',
]);

export function staticCacheControl(filePath: string, publicPath: string): string {
  const relativePath = path.relative(publicPath, filePath).split(path.sep).join('/');

  if (relativePath.startsWith('assets/')) {
    return 'public, max-age=31536000, immutable';
  }

  if (APP_SHELL_FILES.has(relativePath)) {
    return 'no-cache, no-store, must-revalidate';
  }

  return 'public, max-age=3600, must-revalidate';
}
