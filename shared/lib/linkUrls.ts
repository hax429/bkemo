/**
 * URL detection helpers for bookmark cards and save-time enrichment.
 * Keep this dependency-free so app, server, and Obsidian can share it.
 */

/** http(s) URLs and bare www. hosts; trailing punctuation is stripped by normalize. */
export const BARE_URL_RE =
  /(?:https?:\/\/|(?<![/\w])www\.)[^\s<>"'`)\]]+/gi;

const TRAILING_PUNCT_RE = /[.,;:!?)\]]+$/;

const API_PATH_RE =
  /\/(?:api|v\d+|graphql|rest|rpc|oauth|openid-connect)(?:\/|$)/i;

const API_EXT_RE = /\.(?:json|xml|csv|yaml|yml|ndjson|proto)(?:$|\?)/i;

const NON_HTML_TYPES = [
  'application/json',
  'application/xml',
  'text/xml',
  'text/csv',
  'application/csv',
  'application/graphql',
  'application/x-www-form-urlencoded',
  'application/octet-stream',
  'multipart/form-data',
];

/** Max Defuddle+Archive enrichments kicked off per note save. */
export const LINK_ENRICHMENT_CAP = 5;

export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(TRAILING_PUNCT_RE, '');
  if (!trimmed) return null;
  const withProtocol = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Heuristic: URL looks like an API endpoint (skip enrichment entirely). */
export function isApiLikeUrl(raw: string): boolean {
  const href = normalizeUrl(raw);
  if (!href) return true;
  try {
    const url = new URL(href);
    const host = url.hostname.toLowerCase();
    if (host === 'api' || host.startsWith('api.') || host.includes('.api.')) return true;
    if (API_PATH_RE.test(url.pathname)) return true;
    if (API_EXT_RE.test(url.pathname) || API_EXT_RE.test(url.search)) return true;
    return false;
  } catch {
    return true;
  }
}

export function isNonHtmlContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const base = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!base) return false;
  if (base.startsWith('text/html') || base.startsWith('application/xhtml')) return false;
  if (NON_HTML_TYPES.some((t) => base === t || base.startsWith(`${t}+`))) return true;
  if (base.startsWith('image/') || base.startsWith('audio/') || base.startsWith('video/')) return true;
  if (base.startsWith('application/') && !base.includes('html')) return true;
  return false;
}

/**
 * Extract unique normalized http(s) URLs from markdown, skipping fenced and
 * inline code. Explicit markdown links `[text](url)` are left alone (caller
 * only gets bare / autolinked URLs in text).
 */
export function extractBareUrlsFromMarkdown(markdown: string): string[] {
  const withoutCode = stripCodeRegions(markdown);
  // Remove explicit markdown links so only bare URLs remain.
  const withoutMdLinks = withoutCode.replace(/\[([^\]]*)\]\(([^)]+)\)/g, ' ');
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of withoutMdLinks.matchAll(BARE_URL_RE)) {
    const href = normalizeUrl(match[0] ?? '');
    if (!href || seen.has(href)) continue;
    seen.add(href);
    found.push(href);
  }
  return found;
}

export function firstWords(text: string, maxWords = 20): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return `${words.slice(0, maxWords).join(' ')}…`;
}

function stripCodeRegions(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ');
}
