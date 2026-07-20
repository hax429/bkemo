import path from 'node:path';

const APP_SHELL_FILES = new Set([
  'index.html',
  'registerSW.js',
  'manifest.json',
  'manifest.webmanifest',
]);

export function staticCacheControl(filePath: string, publicPath: string): string {
  const relativePath = path.relative(publicPath, filePath).split(path.sep).join('/');
  const normalizedFilePath = filePath.split(path.sep).join('/');
  const fileName = path.posix.basename(normalizedFilePath);

  // In production server/public can be a symlink to dist/public. Express resolves
  // the file path before calling setHeaders, so the relative path can point outside
  // the unresolved static root even though the file is inside it.
  if (relativePath.startsWith('assets/') || normalizedFilePath.includes('/public/assets/')) {
    return 'public, max-age=31536000, immutable';
  }

  if (APP_SHELL_FILES.has(fileName) || /^sw(?:-[A-Za-z0-9._-]+)?\.js$/.test(fileName)) {
    return 'no-cache, no-store, must-revalidate';
  }

  return 'public, max-age=3600, must-revalidate';
}
