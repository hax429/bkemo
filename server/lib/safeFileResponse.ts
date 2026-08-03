/** MIME / extensions that must never be served inline (XSS via attachment). */
const FORCE_DOWNLOAD_MIME = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
  'application/javascript',
  'text/javascript',
  'application/x-javascript',
]);

const FORCE_DOWNLOAD_EXT = /\.(html?|svg|xml|js|mjs|css)$/i;

export function hardenFileContentType(
  contentType: string,
  filePath: string,
): { contentType: string; forceAttachment: boolean } {
  const mime = (contentType || 'application/octet-stream').toLowerCase().split(';')[0]!.trim();
  if (FORCE_DOWNLOAD_MIME.has(mime) || FORCE_DOWNLOAD_EXT.test(filePath)) {
    return { contentType: 'application/octet-stream', forceAttachment: true };
  }
  return { contentType: mime || 'application/octet-stream', forceAttachment: false };
}
