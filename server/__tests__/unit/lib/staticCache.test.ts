import { describe, expect, test } from 'bun:test';
import { staticCacheControl } from '../../../lib/staticCache';

describe('production static cache policy', () => {
  const publicPath = '/srv/bkemo/dist/public';

  test('keeps fingerprinted assets immutable', () => {
    expect(staticCacheControl('/srv/bkemo/dist/public/assets/index-abc123.js', publicPath))
      .toBe('public, max-age=31536000, immutable');
  });

  test.each(['index.html', 'sw.js', 'registerSW.js', 'manifest.webmanifest'])(
    'always revalidates the update-sensitive app shell file %s',
    (fileName) => {
      expect(staticCacheControl(`/srv/bkemo/dist/public/${fileName}`, publicPath))
        .toBe('no-cache, no-store, must-revalidate');
    },
  );

  test('does not mark stable-name static files immutable', () => {
    expect(staticCacheControl('/srv/bkemo/dist/public/icons/Square142x142Logo.png', publicPath))
      .toBe('public, max-age=3600, must-revalidate');
  });
});
