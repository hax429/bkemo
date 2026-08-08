import { parseHTML } from 'linkedom';
import { Defuddle } from 'defuddle/node';
import { getWithProxy } from '../proxy';
import { firstWords, isNonHtmlContentType } from '@shared/lib/linkUrls';

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

export type DefuddleResult =
  | {
      ok: true;
      title: string;
      description: string;
      markdown: string;
      image: string;
      favicon: string;
      wordCount: number;
    }
  | { ok: false; reason: string };

/** Fetch HTML on this server and extract readable Markdown via Defuddle (not the SaaS). */
export async function parseUrlWithDefuddle(url: string): Promise<DefuddleResult> {
  const res: any = await getWithProxy(url, {
    useAdmin: true,
    config: {
      timeout: FETCH_TIMEOUT_MS,
      responseType: 'arraybuffer',
      maxContentLength: MAX_HTML_BYTES,
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'bkemo-link-enrichment/1.0',
      },
      // Follow redirects within axios defaults; SSRF gate already ran on the seed URL.
      maxRedirects: 5,
    },
  });

  if (res?.error) return { ok: false, reason: res.message || 'Failed to fetch page' };

  const contentType = String(res?.headers?.['content-type'] || res?.headers?.['Content-Type'] || '');
  if (isNonHtmlContentType(contentType)) {
    return { ok: false, reason: `Non-HTML content type: ${contentType.split(';')[0]}` };
  }

  const buffer: Buffer = Buffer.isBuffer(res.data)
    ? res.data
    : Buffer.from(res.data ?? '');

  if (buffer.byteLength === 0) return { ok: false, reason: 'Empty response' };
  if (buffer.byteLength > MAX_HTML_BYTES) return { ok: false, reason: 'HTML too large' };

  const html = buffer.toString('utf8');
  try {
    const { document } = parseHTML(html);
    const parsed = await Defuddle(document, url, {
      markdown: true,
    });

    const markdown = String(parsed.contentMarkdown || parsed.content || '').trim();
    const description =
      String(parsed.description || '').trim() ||
      firstWords(markdown.replace(/[#>*_`\[\]()]/g, ' '), 20);

    return {
      ok: true,
      title: String(parsed.title || '').trim(),
      description,
      markdown,
      image: String(parsed.image || '').trim(),
      favicon: String(parsed.favicon || '').trim(),
      wordCount: Number(parsed.wordCount) || 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Defuddle failed';
    return { ok: false, reason: message };
  }
}
