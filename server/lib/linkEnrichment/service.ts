import { unfurl } from 'unfurl.js';
import { prisma } from '../prisma';
import { FileService } from '../files';
import { getWithProxy } from '../proxy';
import { getGlobalConfig } from '@server/routerTrpc/config';
import {
  extractBareUrlsFromMarkdown,
  firstWords,
  LINK_ENRICHMENT_CAP,
} from '@shared/lib/linkUrls';
import { assertEnrichableUrl } from './policy';
import { parseUrlWithDefuddle } from './defuddle';
import { pollSavePageNow, submitSavePageNow } from './archive';
import { assertSafeOutboundUrl } from '../safeOutboundUrl';

type Status = 'pending' | 'running' | 'ready' | 'error' | 'skipped';

const processing = new Set<string>();

async function enrichmentEnabled(): Promise<{
  master: boolean;
  markdown: boolean;
  archive: boolean;
}> {
  const config = await getGlobalConfig({ useAdmin: true });
  const master = config.linkEnrichmentEnabled !== false;
  return {
    master,
    markdown: master && config.linkEnrichmentMarkdown !== false,
    archive: master && config.linkEnrichmentArchive !== false,
  };
}

async function unfurlMeta(url: string): Promise<{
  title: string;
  description: string;
  favicon: string;
  image: string;
}> {
  try {
    const result = await unfurl(url, { timeout: 8000 });
    const image =
      result.open_graph?.images?.[0]?.url ||
      result.twitter_card?.images?.[0]?.url ||
      '';
    return {
      title: result.title ?? '',
      description: firstWords(result.description ?? '', 20),
      favicon: result.favicon ?? '',
      image: typeof image === 'string' ? image : '',
    };
  } catch {
    return { title: '', description: '', favicon: '', image: '' };
  }
}

async function storeRemoteImage(accountId: number, imageUrl: string): Promise<string> {
  if (!imageUrl) return '';
  const safe = await assertSafeOutboundUrl(imageUrl);
  if (!safe.ok) return '';
  try {
    const res: any = await getWithProxy(safe.url.href, {
      useAdmin: true,
      config: {
        responseType: 'arraybuffer',
        timeout: 15_000,
        maxContentLength: 5 * 1024 * 1024,
      },
    });
    if (res?.error || !res?.data) return '';
    const buffer: Buffer = Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data);
    if (!buffer.byteLength) return '';
    const contentType = String(res.headers?.['content-type'] || 'image/jpeg').split(';')[0];
    if (!contentType.startsWith('image/')) return '';
    const ext = contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    const uploaded = await FileService.uploadFile({
      buffer,
      originalName: `bookmark-image.${ext}`,
      type: contentType,
      accountId,
      withOutAttachment: true,
    });
    return uploaded.filePath;
  } catch {
    return '';
  }
}

function overallStatus(markdownStatus: string, archiveStatus: string, flags: { markdown: boolean; archive: boolean }): Status {
  const parts: string[] = [];
  if (flags.markdown) parts.push(markdownStatus);
  if (flags.archive) parts.push(archiveStatus);
  if (parts.length === 0) return 'ready';
  if (parts.every((s) => s === 'ready' || s === 'skipped')) return 'ready';
  if (parts.some((s) => s === 'pending' || s === 'running')) return 'running';
  if (parts.every((s) => s === 'error' || s === 'skipped')) return 'error';
  return 'ready';
}

/** After note create/update: enqueue enrichment for up to 5 new/changed bare URLs. */
export async function scheduleLinkEnrichmentForNote(input: {
  noteId: number;
  accountId: number;
  content: string;
}): Promise<void> {
  const flags = await enrichmentEnabled();
  if (!flags.master) return;

  const urls = extractBareUrlsFromMarkdown(input.content);
  if (urls.length === 0) {
    await prisma.linkEnrichment.deleteMany({ where: { noteId: input.noteId } });
    return;
  }

  const existing = await prisma.linkEnrichment.findMany({
    where: { noteId: input.noteId },
    select: { id: true, url: true, status: true, markdownStatus: true, archiveStatus: true },
  });
  const existingByUrl = new Map(existing.map((row) => [row.url, row]));
  const keep = new Set(urls);
  const staleIds = existing.filter((row) => !keep.has(row.url)).map((row) => row.id);
  if (staleIds.length) {
    await prisma.linkEnrichment.deleteMany({ where: { id: { in: staleIds } } });
  }

  const toProcess: string[] = [];
  for (const url of urls) {
    const row = existingByUrl.get(url);
    if (!row) {
      toProcess.push(url);
      continue;
    }
    if (row.status === 'error' || row.markdownStatus === 'error' || row.archiveStatus === 'error') {
      toProcess.push(url);
    }
  }

  const capped = toProcess.slice(0, LINK_ENRICHMENT_CAP);
  for (const url of capped) {
    const gate = await assertEnrichableUrl(url);
    if (!gate.ok) {
      await prisma.linkEnrichment.upsert({
        where: { noteId_url: { noteId: input.noteId, url } },
        create: {
          accountId: input.accountId,
          noteId: input.noteId,
          url,
          status: 'skipped',
          markdownStatus: 'skipped',
          archiveStatus: 'skipped',
          error: gate.reason,
        },
        update: {
          status: 'skipped',
          markdownStatus: 'skipped',
          archiveStatus: 'skipped',
          error: gate.reason,
        },
      });
      continue;
    }

    const row = await prisma.linkEnrichment.upsert({
      where: { noteId_url: { noteId: input.noteId, url: gate.url } },
      create: {
        accountId: input.accountId,
        noteId: input.noteId,
        url: gate.url,
        status: 'pending',
        markdownStatus: flags.markdown ? 'pending' : 'skipped',
        archiveStatus: flags.archive ? 'pending' : 'skipped',
        error: '',
      },
      update: {
        status: 'pending',
        markdownStatus: flags.markdown ? 'pending' : 'skipped',
        archiveStatus: flags.archive ? 'pending' : 'skipped',
        error: '',
        markdown: flags.markdown ? undefined : '',
        archiveUrl: flags.archive ? undefined : '',
      },
    });
    void processLinkEnrichment(row.id);
  }
}

export async function processLinkEnrichment(id: string): Promise<void> {
  if (processing.has(id)) return;
  processing.add(id);
  try {
    const row = await prisma.linkEnrichment.findUnique({ where: { id } });
    if (!row) return;
    if (row.status === 'skipped') return;

    const flags = await enrichmentEnabled();
    if (!flags.master) {
      await prisma.linkEnrichment.update({
        where: { id },
        data: { status: 'skipped', markdownStatus: 'skipped', archiveStatus: 'skipped', error: 'Disabled' },
      });
      return;
    }

    await prisma.linkEnrichment.update({
      where: { id },
      data: { status: 'running', error: '' },
    });

    const meta = await unfurlMeta(row.url);
    let imagePath = row.imagePath;
    const imageUrl = meta.image || row.imageUrl;
    if (imageUrl && !imagePath) {
      imagePath = await storeRemoteImage(row.accountId, imageUrl);
    }

    let markdownStatus = flags.markdown ? 'running' : 'skipped';
    let archiveStatus = flags.archive ? row.archiveStatus : 'skipped';
    let markdown = row.markdown;
    let title = meta.title || row.title;
    let description = meta.description || row.description;
    let favicon = meta.favicon || row.favicon;
    let archiveUrl = row.archiveUrl;
    let archiveJobId = row.archiveJobId;
    const errors: string[] = [];

    if (flags.markdown) {
      const parsed = await parseUrlWithDefuddle(row.url);
      if (parsed.ok) {
        markdown = parsed.markdown;
        title = parsed.title || title;
        description = parsed.description || description;
        favicon = parsed.favicon || favicon;
        if (parsed.image && !imagePath) {
          imagePath = await storeRemoteImage(row.accountId, parsed.image);
        }
        markdownStatus = 'ready';
      } else {
        markdownStatus = 'error';
        errors.push(`markdown: ${parsed.reason}`);
      }
    }

    if (flags.archive) {
      if (!archiveUrl) {
        if (!archiveJobId) {
          const submitted = await submitSavePageNow(row.url);
          if (submitted.ok) {
            archiveJobId = submitted.jobId;
            archiveStatus = 'pending';
          } else {
            archiveStatus = 'error';
            errors.push(`archive: ${submitted.reason}`);
          }
        }
        if (archiveJobId && archiveStatus !== 'error') {
          archiveStatus = await waitForArchive(archiveJobId, (url) => {
            archiveUrl = url;
          }, (reason) => {
            errors.push(`archive: ${reason}`);
          });
        }
      } else {
        archiveStatus = 'ready';
      }
    }

    const status = overallStatus(markdownStatus, archiveStatus, flags);
    await prisma.linkEnrichment.update({
      where: { id },
      data: {
        status,
        markdownStatus,
        archiveStatus,
        title,
        description,
        favicon,
        imageUrl,
        imagePath,
        markdown,
        archiveUrl,
        archiveJobId,
        error: errors.join('; '),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Enrichment failed';
    await prisma.linkEnrichment.update({
      where: { id },
      data: { status: 'error', error: message },
    }).catch(() => undefined);
  } finally {
    processing.delete(id);
  }
}

async function waitForArchive(
  jobId: string,
  onSuccess: (url: string) => void,
  onError: (reason: string) => void,
): Promise<Status> {
  const attempts = 12;
  for (let i = 0; i < attempts; i++) {
    const polled = await pollSavePageNow(jobId);
    if (!polled.ok) {
      onError(polled.reason);
      return 'error';
    }
    if (polled.status === 'success' && polled.archiveUrl) {
      onSuccess(polled.archiveUrl);
      return 'ready';
    }
    if (polled.status === 'error') {
      onError(polled.message || 'Archive failed');
      return 'error';
    }
    await sleep(5_000);
  }
  onError('Archive timed out');
  return 'error';
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryLinkEnrichment(id: string, accountId: number): Promise<void> {
  const row = await prisma.linkEnrichment.findFirst({ where: { id, accountId } });
  if (!row) return;
  await prisma.linkEnrichment.update({
    where: { id },
    data: {
      status: 'pending',
      markdownStatus: 'pending',
      archiveStatus: 'pending',
      error: '',
      archiveJobId: '',
    },
  });
  await processLinkEnrichment(id);
}

export async function updateLinkEnrichmentMarkdown(input: {
  id: string;
  accountId: number;
  markdown: string;
}): Promise<void> {
  await prisma.linkEnrichment.updateMany({
    where: { id: input.id, accountId: input.accountId },
    data: { markdown: input.markdown, markdownStatus: 'ready' },
  });
}

/** Resume pending/running jobs after process restart. */
export async function resumeLinkEnrichmentJobs(): Promise<void> {
  const rows = await prisma.linkEnrichment.findMany({
    where: { status: { in: ['pending', 'running'] } },
    select: { id: true },
    take: 50,
  });
  for (const row of rows) {
    void processLinkEnrichment(row.id);
  }
}
