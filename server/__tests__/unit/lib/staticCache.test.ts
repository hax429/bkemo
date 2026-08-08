import { describe, expect, test } from 'bun:test';
import { staticCacheControl } from '../../../lib/staticCache';

describe('production static cache policy', () => {
  const publicPath = '/srv/bkemo/out/output/public';

  test('keeps fingerprinted assets immutable', () => {
    expect(staticCacheControl('/srv/bkemo/out/output/public/assets/index-abc123.js', publicPath))
      .toBe('public, max-age=31536000, immutable');
  });

  test.each(['index.html', 'sw.js', 'sw-bkemo-v2.js', 'registerSW.js', 'manifest.webmanifest'])(
    'always revalidates the update-sensitive app shell file %s',
    (fileName) => {
      expect(staticCacheControl(`/srv/bkemo/out/output/public/${fileName}`, publicPath))
        .toBe('no-cache, no-store, must-revalidate');
    },
  );

  test('does not mark stable-name static files immutable', () => {
    expect(staticCacheControl('/srv/bkemo/out/output/public/icons/Square142x142Logo.png', publicPath))
      .toBe('public, max-age=3600, must-revalidate');
  });

  test('handles file paths resolved through the production public symlink', () => {
    const symlinkRoot = '/srv/bkemo/server/public';

    expect(staticCacheControl('/srv/bkemo/out/output/public/sw-bkemo-v2.js', symlinkRoot))
      .toBe('no-cache, no-store, must-revalidate');
    expect(staticCacheControl('/srv/bkemo/out/output/public/assets/index-abc123.js', symlinkRoot))
      .toBe('public, max-age=31536000, immutable');
  });
});
