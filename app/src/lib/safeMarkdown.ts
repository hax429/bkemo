import type { Options as SanitizeOptions } from 'rehype-sanitize';
import { defaultSchema } from 'rehype-sanitize';

/** Sanitize schema for memo markdown: allow GFM + bkemo `<mark>` / `<u>` only. */
export const bkemoSanitizeSchema: SanitizeOptions = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'mark', 'u'],
  attributes: {
    ...defaultSchema.attributes,
    mark: ['className', 'class'],
    code: [...(defaultSchema.attributes?.code ?? []), 'className', 'class'],
    span: [...(defaultSchema.attributes?.span ?? []), 'className', 'class'],
  },
};

/** Block javascript:/data:/vbscript: and other non-navigable schemes. */
export function safeHref(href: string | null | undefined): string | undefined {
  if (typeof href !== 'string') return undefined;
  const trimmed = href.trim();
  if (!trimmed) return undefined;
  if (/^(javascript|data|vbscript|blob):/i.test(trimmed)) return undefined;
  return trimmed;
}

/** True when a URL is safe to fetch for link previews (absolute http/https only). */
export function isPreviewableHref(href: string | null | undefined): boolean {
  const safe = safeHref(href);
  if (!safe) return false;
  try {
    const u = new URL(safe);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
