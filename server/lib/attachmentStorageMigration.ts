import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import { Prisma } from '@prisma/client';
import { UPLOAD_FILE_PATH } from '../../shared/lib/pathConstant';
import { prisma } from '../prisma';
import { getGlobalConfig } from '../routerTrpc/config';
import { stableAttachmentPath } from './attachmentPaths';
import { FileService } from './files';

export type AttachmentMigrationDirection = 'local-to-s3' | 's3-to-local';

export type AttachmentStorageStats = {
  databaseBytes: number | null;
  totalCount: number;
  totalBytes: number;
  localCount: number;
  localBytes: number;
  s3Count: number;
  s3Bytes: number;
};

const runningJobs = new Set<string>();
const cleaningJobs = new Set<string>();

function decimalNumber(value: unknown): number {
  if (value == null) return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function safeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'Attachment migration failed';
  return raw
    .replace(/(?:postgres(?:ql)?|s3):\/\/[^\s]+/gi, '[redacted connection]')
    .replace(/(access[_ -]?key|secret[_ -]?key|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 1000);
}

function providers(direction: AttachmentMigrationDirection) {
  return direction === 'local-to-s3'
    ? { source: 'local' as const, destination: 's3' as const, sourcePrefix: '/api/file/' }
    : { source: 's3' as const, destination: 'local' as const, sourcePrefix: '/api/s3file/' };
}

export async function getAttachmentStorageStats(): Promise<AttachmentStorageStats> {
  const localWhere = { path: { startsWith: '/api/file/' }, type: { not: 'folder' }, name: { not: '.folder' } } as const;
  const s3Where = { path: { startsWith: '/api/s3file/' }, type: { not: 'folder' }, name: { not: '.folder' } } as const;

  const [totalCount, localCount, s3Count, totalSize, localSize, s3Size, databaseSize] = await Promise.all([
    prisma.attachments.count({ where: { type: { not: 'folder' }, name: { not: '.folder' } } }),
    prisma.attachments.count({ where: localWhere }),
    prisma.attachments.count({ where: s3Where }),
    prisma.attachments.aggregate({ where: { type: { not: 'folder' }, name: { not: '.folder' } }, _sum: { size: true } }),
    prisma.attachments.aggregate({ where: localWhere, _sum: { size: true } }),
    prisma.attachments.aggregate({ where: s3Where, _sum: { size: true } }),
    prisma.$queryRaw<Array<{ bytes: string }>>`SELECT pg_database_size(current_database())::bigint::text AS bytes`
      .then((rows) => Number(rows[0]?.bytes ?? 0))
      .catch(() => null),
  ]);

  return {
    databaseBytes: databaseSize,
    totalCount,
    totalBytes: decimalNumber(totalSize._sum.size),
    localCount,
    localBytes: decimalNumber(localSize._sum.size),
    s3Count,
    s3Bytes: decimalNumber(s3Size._sum.size),
  };
}

async function replaceStoredPathReferences(
  oldPath: string,
  newStoredPath: string,
  attachment: { id: number; portableId: string },
) {
  const keyParts = newStoredPath
    .replace('/api/file/', '')
    .replace('/api/s3file/', '')
    .split('/');
  const prefixPath = keyParts.slice(0, -1).join(',');
  const publicPath = stableAttachmentPath(attachment.portableId);

  await prisma.$transaction(async (tx) => {
    await tx.attachments.update({
      where: { id: attachment.id },
      data: { path: newStoredPath, depth: keyParts.length - 1, perfixPath: prefixPath },
    });
    await tx.accounts.updateMany({ where: { image: oldPath }, data: { image: publicPath } });
    await tx.comments.updateMany({ where: { guestAvatar: oldPath }, data: { guestAvatar: publicPath } });

    const [notes, histories, comments, notifications] = await Promise.all([
      tx.notes.findMany({ where: { content: { contains: oldPath } }, select: { id: true, content: true } }),
      tx.noteHistory.findMany({ where: { content: { contains: oldPath } }, select: { id: true, content: true } }),
      tx.comments.findMany({ where: { content: { contains: oldPath } }, select: { id: true, content: true } }),
      tx.notifications.findMany({ where: { content: { contains: oldPath } }, select: { id: true, content: true } }),
    ]);

    for (const row of notes) await tx.notes.update({ where: { id: row.id }, data: { content: row.content.split(oldPath).join(publicPath) } });
    for (const row of histories) await tx.noteHistory.update({ where: { id: row.id }, data: { content: row.content.split(oldPath).join(publicPath) } });
    for (const row of comments) await tx.comments.update({ where: { id: row.id }, data: { content: row.content.split(oldPath).join(publicPath) } });
    for (const row of notifications) await tx.notifications.update({ where: { id: row.id }, data: { content: row.content.split(oldPath).join(publicPath) } });
  }, { maxWait: 10_000, timeout: 120_000 });
}

async function refreshJobSummary(jobId: string, terminal = false) {
  const [migrated, failed, skipped, migratedBytes] = await Promise.all([
    prisma.storageMigrationItem.count({ where: { jobId, status: 'completed' } }),
    prisma.storageMigrationItem.count({ where: { jobId, status: 'failed' } }),
    prisma.storageMigrationItem.count({ where: { jobId, status: 'skipped' } }),
    prisma.storageMigrationItem.aggregate({ where: { jobId, status: 'completed' }, _sum: { size: true } }),
  ]);
  const processed = migrated + failed + skipped;
  return prisma.storageMigrationJob.update({
    where: { id: jobId },
    data: {
      processed,
      migrated,
      failed,
      skipped,
      migratedBytes: migratedBytes._sum.size ?? new Prisma.Decimal(0),
      ...(terminal ? {
        status: failed ? 'completed_with_errors' : 'completed',
        completedAt: new Date(),
      } : {}),
    },
  });
}

async function recoverOrCopyItem(itemId: number) {
  const item = await prisma.storageMigrationItem.findUnique({ where: { id: itemId } });
  if (!item) return;
  const attachment = await prisma.attachments.findUnique({
    where: { id: item.attachmentId },
    select: { id: true, portableId: true, path: true, accountId: true, name: true, type: true },
  });
  if (!attachment) {
    await prisma.storageMigrationItem.update({
      where: { id: item.id },
      data: { status: 'skipped', errorMessage: 'Attachment metadata was deleted; stale transfer record skipped' },
    });
    return;
  }

  if (item.destinationPath && attachment.path === item.destinationPath) {
    await prisma.storageMigrationItem.update({ where: { id: item.id }, data: { status: 'completed', errorMessage: null } });
    return;
  }
  if (attachment.path !== item.sourcePath) throw new Error('Attachment path changed after this job was created');

  let destinationPath = item.destinationPath;
  if (destinationPath) {
    const size = await FileService.getStoredObjectSize(destinationPath).catch(() => -1);
    if (size === decimalNumber(item.size)) {
      await replaceStoredPathReferences(item.sourcePath, destinationPath, attachment);
      await prisma.storageMigrationItem.update({ where: { id: item.id }, data: { status: 'completed', errorMessage: null } });
      return;
    }
    await FileService.deleteStoredObject(destinationPath).catch(() => undefined);
    destinationPath = null;
  }

  const buffer = await FileService.getFileBuffer(item.sourcePath);
  const uploaded = await FileService.uploadFile({
    buffer,
    originalName: item.name || attachment.name || 'attachment',
    type: attachment.type || 'application/octet-stream',
    withOutAttachment: true,
    accountId: attachment.accountId ?? 0,
  });
  destinationPath = uploaded.storedPath;
  await prisma.storageMigrationItem.update({ where: { id: item.id }, data: { destinationPath } });

  const storedSize = await FileService.getStoredObjectSize(destinationPath);
  if (storedSize !== buffer.length) throw new Error(`Verification failed: expected ${buffer.length} bytes, found ${storedSize}`);

  await replaceStoredPathReferences(item.sourcePath, destinationPath, attachment);
  await prisma.storageMigrationItem.update({ where: { id: item.id }, data: { status: 'completed', errorMessage: null } });
}

export async function runAttachmentMigrationJob(jobId: string) {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);
  try {
    const job = await prisma.storageMigrationJob.findUnique({ where: { id: jobId } });
    if (!job) return;
    const config = await getGlobalConfig({ useAdmin: true });
    if ((config.objectStorage === 's3' ? 's3' : 'local') !== job.destinationProvider) {
      throw new Error(`Activate ${job.destinationProvider === 's3' ? 'S3/R2' : 'local storage'} before resuming this migration`);
    }

    await prisma.storageMigrationItem.updateMany({ where: { jobId, status: 'copying' }, data: { status: 'pending' } });
    await prisma.storageMigrationJob.update({ where: { id: jobId }, data: { status: 'running', errorMessage: null, completedAt: null } });

    while (true) {
      const item = await prisma.storageMigrationItem.findFirst({
        where: { jobId, status: 'pending' },
        orderBy: { id: 'asc' },
        select: { id: true },
      });
      if (!item) break;
      await prisma.storageMigrationItem.update({
        where: { id: item.id },
        data: { status: 'copying', attempts: { increment: 1 }, errorMessage: null },
      });
      try {
        await recoverOrCopyItem(item.id);
      } catch (error) {
        await prisma.storageMigrationItem.update({
          where: { id: item.id },
          data: { status: 'failed', errorMessage: safeError(error) },
        });
      }
      await refreshJobSummary(jobId);
    }
    await refreshJobSummary(jobId, true);
  } catch (error) {
    await prisma.storageMigrationJob.update({
      where: { id: jobId },
      data: { status: 'failed', errorMessage: safeError(error), completedAt: new Date() },
    }).catch(() => undefined);
  } finally {
    runningJobs.delete(jobId);
  }
}

async function ensureLocalCapacity(requiredBytes: number) {
  const stats = await fs.statfs(UPLOAD_FILE_PATH);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  const requiredWithHeadroom = Math.ceil(requiredBytes * 1.1);
  if (freeBytes < requiredWithHeadroom) {
    throw new Error(`Local storage needs ${requiredWithHeadroom} bytes including safety headroom, but only ${freeBytes} bytes are free`);
  }
}

export async function startAttachmentMigration(direction: AttachmentMigrationDirection, requestedById: number) {
  const { source, destination, sourcePrefix } = providers(direction);
  const config = await getGlobalConfig({ useAdmin: true });
  const active = config.objectStorage === 's3' ? 's3' : 'local';
  if (active !== destination) throw new Error(`Activate ${destination === 's3' ? 'S3/R2' : 'local storage'} first`);

  const existing = await prisma.storageMigrationJob.findFirst({
    where: { status: { in: ['queued', 'running'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return serializeAttachmentMigrationJob(existing);

  const attachments = await prisma.attachments.findMany({
    where: { path: { startsWith: sourcePrefix }, type: { not: 'folder' }, name: { not: '.folder' } },
    orderBy: { id: 'asc' },
    select: { id: true, portableId: true, path: true, name: true, size: true },
  });
  const totalBytes = attachments.reduce((sum, item) => sum + decimalNumber(item.size), 0);
  if (direction === 's3-to-local' && totalBytes) await ensureLocalCapacity(totalBytes);

  const id = randomUUID();
  await prisma.storageMigrationJob.create({
    data: {
      id,
      direction,
      status: attachments.length ? 'queued' : 'completed',
      sourceProvider: source,
      destinationProvider: destination,
      totalCount: attachments.length,
      totalBytes,
      requestedById,
      completedAt: attachments.length ? null : new Date(),
    },
  });
  for (let index = 0; index < attachments.length; index += 500) {
    await prisma.storageMigrationItem.createMany({
      data: attachments.slice(index, index + 500).map((item) => ({
        jobId: id,
        attachmentId: item.id,
        attachmentPortableId: item.portableId,
        sourcePath: item.path,
        name: item.name,
        size: item.size,
      })),
    });
  }
  if (attachments.length) void runAttachmentMigrationJob(id);
  return getAttachmentMigrationJob(id);
}

export async function retryAttachmentMigration(jobId: string) {
  const job = await prisma.storageMigrationJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error('Migration job not found');
  await prisma.storageMigrationItem.updateMany({ where: { jobId, status: 'failed' }, data: { status: 'pending', errorMessage: null } });
  await prisma.storageMigrationJob.update({ where: { id: jobId }, data: { status: 'queued', errorMessage: null, completedAt: null } });
  void runAttachmentMigrationJob(jobId);
  return getAttachmentMigrationJob(jobId);
}

async function reconcileStaleAttachmentItems(jobId: string) {
  const candidates = await prisma.storageMigrationItem.findMany({
    where: { jobId, status: { in: ['pending', 'copying', 'failed'] } },
    select: { id: true, attachmentId: true },
  });
  if (!candidates.length) return 0;

  const existing = await prisma.attachments.findMany({
    where: { id: { in: candidates.map((item) => item.attachmentId) } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((item) => item.id));
  const staleIds = candidates.filter((item) => !existingIds.has(item.attachmentId)).map((item) => item.id);
  if (!staleIds.length) return 0;

  await prisma.storageMigrationItem.updateMany({
    where: { id: { in: staleIds } },
    data: { status: 'skipped', errorMessage: 'Attachment metadata was deleted; stale transfer record skipped' },
  });
  return staleIds.length;
}

function isMissingObject(error: any) {
  return error?.code === 'ENOENT' || error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404;
}

export async function cleanupAttachmentMigrationSources(jobId: string) {
  if (cleaningJobs.has(jobId)) return;
  cleaningJobs.add(jobId);
  try {
    await prisma.storageMigrationJob.update({ where: { id: jobId }, data: { cleanupStatus: 'running' } });
    const items = await prisma.storageMigrationItem.findMany({
      where: { jobId, status: 'completed', sourceDeletedAt: null },
      orderBy: { id: 'asc' },
    });
    for (const item of items) {
      try {
        await FileService.deleteStoredObject(item.sourcePath);
        await prisma.storageMigrationItem.update({ where: { id: item.id }, data: { sourceDeletedAt: new Date() } });
        await prisma.storageMigrationJob.update({ where: { id: jobId }, data: { cleanupDeleted: { increment: 1 } } });
      } catch (error) {
        if (isMissingObject(error)) {
          await prisma.storageMigrationItem.update({ where: { id: item.id }, data: { sourceDeletedAt: new Date() } });
          await prisma.storageMigrationJob.update({ where: { id: jobId }, data: { cleanupDeleted: { increment: 1 } } });
        } else {
          await prisma.storageMigrationJob.update({ where: { id: jobId }, data: { cleanupFailed: { increment: 1 } } });
        }
      }
    }
    await prisma.storageMigrationJob.update({ where: { id: jobId }, data: { cleanupStatus: 'completed' } });
  } catch (error) {
    await prisma.storageMigrationJob.update({ where: { id: jobId }, data: { cleanupStatus: 'failed', errorMessage: safeError(error) } }).catch(() => undefined);
  } finally {
    cleaningJobs.delete(jobId);
  }
}

export async function startAttachmentSourceCleanup(jobId: string, confirmation: string) {
  if (confirmation !== 'DELETE VERIFIED ORIGINALS') throw new Error('Confirmation text did not match');
  const job = await prisma.storageMigrationJob.findUnique({ where: { id: jobId } });
  if (!job || !['completed', 'completed_with_errors'].includes(job.status)) throw new Error('Only a finished migration can clean up originals');
  void cleanupAttachmentMigrationSources(jobId);
  return getAttachmentMigrationJob(jobId);
}

export async function resumeAttachmentMigrationJobs() {
  const jobs = await prisma.storageMigrationJob.findMany({ where: { status: { in: ['queued', 'running'] } } });
  for (const job of jobs) void runAttachmentMigrationJob(job.id);
  const cleanupJobs = await prisma.storageMigrationJob.findMany({ where: { cleanupStatus: 'running' } });
  for (const job of cleanupJobs) void cleanupAttachmentMigrationSources(job.id);
}

function serializeAttachmentMigrationJob(job: any, errors: any[] = []) {
  return {
    id: job.id,
    direction: job.direction as AttachmentMigrationDirection,
    status: job.status as string,
    sourceProvider: job.sourceProvider as 'local' | 's3',
    destinationProvider: job.destinationProvider as 'local' | 's3',
    totalCount: job.totalCount,
    totalBytes: decimalNumber(job.totalBytes),
    processed: job.processed,
    migrated: job.migrated,
    migratedBytes: decimalNumber(job.migratedBytes),
    failed: job.failed,
    skipped: job.skipped,
    cleanupStatus: job.cleanupStatus,
    cleanupDeleted: job.cleanupDeleted,
    cleanupFailed: job.cleanupFailed,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    errors: errors.map((item) => ({ id: item.attachmentId, name: item.name, message: item.errorMessage ?? 'Migration failed' })),
  };
}

export async function getAttachmentMigrationJob(jobId?: string) {
  let job = jobId
    ? await prisma.storageMigrationJob.findUnique({ where: { id: jobId } })
    : await prisma.storageMigrationJob.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!job) return null;
  const reconciled = await reconcileStaleAttachmentItems(job.id);
  if (reconciled) {
    job = await refreshJobSummary(job.id, ['completed', 'completed_with_errors', 'failed'].includes(job.status));
  }
  const errors = await prisma.storageMigrationItem.findMany({
    where: { jobId: job.id, status: 'failed' },
    orderBy: { updatedAt: 'desc' },
    take: 20,
    select: { attachmentId: true, name: true, errorMessage: true },
  });
  return serializeAttachmentMigrationJob(job, errors);
}
