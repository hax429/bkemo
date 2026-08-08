import { assertSafeOutboundUrl } from '../safeOutboundUrl';
import { isApiLikeUrl, normalizeUrl } from '@shared/lib/linkUrls';

export type EnrichableUrl =
  | { ok: true; url: string }
  | { ok: false; reason: string };

/** Skip private/intranet/localhost and clearly-API URLs entirely. */
export async function assertEnrichableUrl(raw: string): Promise<EnrichableUrl> {
  const normalized = normalizeUrl(raw);
  if (!normalized) return { ok: false, reason: 'Invalid URL' };
  if (isApiLikeUrl(normalized)) return { ok: false, reason: 'API URL' };

  const safe = await assertSafeOutboundUrl(normalized);
  if (!safe.ok) return { ok: false, reason: safe.reason };
  return { ok: true, url: safe.url.href };
}
