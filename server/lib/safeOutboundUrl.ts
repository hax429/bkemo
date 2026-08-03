import net from 'net';
import { lookup } from 'dns/promises';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

export function isPrivateOrSpecialIp(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^::ffff:/, '');
  if (normalized === '::1' || normalized === '0.0.0.0') return true;

  if (net.isIPv4(normalized)) {
    const parts = normalized.split('.').map(Number);
    const [a, b] = parts;
    if (a === undefined || b === undefined) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  if (net.isIPv6(normalized)) {
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // ULA
    if (normalized.startsWith('fe80')) return true; // link-local
    if (normalized.startsWith('ff')) return true; // multicast
    return false;
  }

  return true;
}

type SafeUrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** Parse and statically reject clearly unsafe URLs (before DNS). */
export function assertSafeOutboundUrlSync(raw: string): SafeUrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Only http/https URLs are allowed' };
  }

  if (url.username || url.password) {
    return { ok: false, reason: 'URLs with credentials are not allowed' };
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname) return { ok: false, reason: 'Missing hostname' };
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: 'Hostname is not allowed' };
  }
  if (hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return { ok: false, reason: 'Hostname is not allowed' };
  }

  if (net.isIP(hostname) && isPrivateOrSpecialIp(hostname)) {
    return { ok: false, reason: 'Private or special-use IP addresses are not allowed' };
  }

  return { ok: true, url };
}

/** Resolve DNS and reject if any address is private/special (SSRF). */
export async function assertSafeOutboundUrl(raw: string): Promise<SafeUrlCheck> {
  const sync = assertSafeOutboundUrlSync(raw);
  if (!sync.ok) return sync;

  const hostname = sync.url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(hostname)) return sync;

  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    if (!records.length) return { ok: false, reason: 'Hostname could not be resolved' };
    for (const record of records) {
      if (isPrivateOrSpecialIp(record.address)) {
        return { ok: false, reason: 'Hostname resolves to a private or special-use address' };
      }
    }
  } catch {
    return { ok: false, reason: 'Hostname could not be resolved' };
  }

  return sync;
}
