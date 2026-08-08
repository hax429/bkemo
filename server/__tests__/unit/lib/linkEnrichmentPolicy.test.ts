import { describe, expect, test } from 'bun:test';
import { isApiLikeUrl } from '@shared/lib/linkUrls';
import { assertSafeOutboundUrlSync } from '../../../lib/safeOutboundUrl';

/** Mirrors assertEnrichableUrl sync gates (API + static SSRF). */
function syncEnrichable(raw: string): { ok: boolean; reason?: string } {
  if (isApiLikeUrl(raw)) return { ok: false, reason: 'API URL' };
  const safe = assertSafeOutboundUrlSync(raw);
  if (!safe.ok) return { ok: false, reason: safe.reason };
  return { ok: true };
}

describe('link enrichment policy', () => {
  test('rejects private and API URLs', () => {
    expect(syncEnrichable('http://127.0.0.1/x').ok).toBe(false);
    expect(syncEnrichable('https://api.example.com/v1').ok).toBe(false);
    expect(syncEnrichable('https://example.com/blog').ok).toBe(true);
  });
});
