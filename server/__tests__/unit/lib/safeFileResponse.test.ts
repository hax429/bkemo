import { describe, expect, test } from 'bun:test';
import { hardenFileContentType } from '../../../lib/safeFileResponse';

describe('hardenFileContentType', () => {
  test('forces download for html/svg/js', () => {
    expect(hardenFileContentType('text/html', 'x.html')).toEqual({
      contentType: 'application/octet-stream',
      forceAttachment: true,
    });
    expect(hardenFileContentType('image/svg+xml', 'icon.svg').forceAttachment).toBe(true);
    expect(hardenFileContentType('application/javascript', 'x.js').forceAttachment).toBe(true);
  });

  test('keeps images inline', () => {
    expect(hardenFileContentType('image/png', 'a.png')).toEqual({
      contentType: 'image/png',
      forceAttachment: false,
    });
  });
});
