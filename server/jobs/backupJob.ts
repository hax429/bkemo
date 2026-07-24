import path from 'path';
import fs from 'fs';
import { mkdir, readdir, unlink, writeFile } from 'fs/promises';
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { DBBAK_TASK_NAME } from '@shared/lib/sharedConstant';
import { UPLOAD_FILE_PATH } from '@shared/lib/pathConstant';
import { prisma } from '../prisma';
import { BaseScheduleJob } from './baseScheduleJob';
import { CreateNotification } from '../routerTrpc/notification';
import { NotificationType } from '@shared/lib/prismaZodType';
import { FileService } from '../lib/files';
import { getGlobalConfig } from '../routerTrpc/config';
import { buildBkArchive, getFirstSuperadminContext } from '../lib/bkemoTransfer';
import { decryptStorageCredential } from '../lib/storageCredentialEncryption';

export const BACKUP_STATUS_CACHE_KEY = 'scheduled-bk-backup';
export const BKEMO_BACKUP_PREFIX = 'BKEMO_BACKUP';
export const BACKUP_RETENTION = 7;
export const SCHEDULE_TIMEZONES = ['UTC', 'America/New_York'] as const;
export type ScheduleTimezone = (typeof SCHEDULE_TIMEZONES)[number];

const BACKUP_PASSPHRASE_CONFIG_KEY = 'scheduledBackupPassphrase';

export type BackupJobStatus = {
  filePath?: string;
  filename?: string;
  scope?: 'account' | 'site';
  storage?: 'local' | 's3';
  bytes?: number;
  completedAt?: string;
  error?: string;
  retained?: number;
};

async function saveStatus(status: BackupJobStatus): Promise<void> {
  await prisma.cache.upsert({
    where: { key: BACKUP_STATUS_CACHE_KEY },
    update: { value: status },
    create: { key: BACKUP_STATUS_CACHE_KEY, value: status },
  });
}

export async function getScheduledBackupPassphrase(): Promise<string | null> {
  const row = await prisma.config.findFirst({ where: { key: BACKUP_PASSPHRASE_CONFIG_KEY } });
  if (!row?.config) return null;
  const wrapped = row.config as { type?: string; value?: unknown } | string;
  const raw = typeof wrapped === 'string' ? wrapped : String(wrapped?.value ?? '');
  const decrypted = decryptStorageCredential(raw);
  return decrypted?.trim() ? decrypted : null;
}

export async function hasScheduledBackupPassphrase(): Promise<boolean> {
  return Boolean(await getScheduledBackupPassphrase());
}

function isBackupFilename(name: string): boolean {
  return /^bkemo-backup-.+\.bk$/i.test(name);
}

async function pruneLocalBackups(directory: string): Promise<number> {
  const entries = (await readdir(directory).catch(() => []))
    .filter(isBackupFilename)
    .map((name) => {
      const fullPath = path.join(directory, name);
      const stat = fs.statSync(fullPath);
      return { name, fullPath, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const stale = entries.slice(BACKUP_RETENTION);
  await Promise.all(stale.map((entry) => unlink(entry.fullPath).catch(() => undefined)));
  return Math.min(entries.length, BACKUP_RETENTION);
}

async function pruneS3Backups(bucket: string): Promise<number> {
  const { s3ClientInstance } = await FileService.getS3Client();
  const listed = await s3ClientInstance.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: `${BKEMO_BACKUP_PREFIX}/`,
  }));
  const objects = (listed.Contents ?? [])
    .filter((object) => object.Key && isBackupFilename(path.basename(object.Key)))
    .sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0));

  const stale = objects.slice(BACKUP_RETENTION);
  if (stale.length) {
    await s3ClientInstance.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: stale.map((object) => ({ Key: object.Key! })),
        Quiet: true,
      },
    }));
  }
  return Math.min(objects.length, BACKUP_RETENTION);
}

export class BackupJob extends BaseScheduleJob {
  protected static taskName = DBBAK_TASK_NAME;
  protected static cronSchedule = '0 0 * * *';

  protected static async RunTask() {
    try {
      const passphrase = await getScheduledBackupPassphrase();
      if (!passphrase || passphrase.length < 8) {
        throw new Error('Scheduled .bk backup requires a passphrase of at least 8 characters');
      }

      const config = await getGlobalConfig({ useAdmin: true });
      const ctx = await getFirstSuperadminContext();
      const archive = await buildBkArchive(ctx, passphrase);

      let result: BackupJobStatus;
      if (config.objectStorage === 's3') {
        const { s3ClientInstance } = await FileService.getS3Client();
        const key = `${BKEMO_BACKUP_PREFIX}/${archive.filename}`;
        await s3ClientInstance.send(new PutObjectCommand({
          Bucket: config.s3Bucket,
          Key: key,
          Body: archive.buffer,
          ContentType: 'application/octet-stream',
        }));
        const retained = await pruneS3Backups(String(config.s3Bucket));
        result = {
          filePath: `/api/s3file/${key}`,
          filename: archive.filename,
          scope: archive.scope,
          storage: 's3',
          bytes: archive.buffer.length,
          completedAt: new Date().toISOString(),
          retained,
        };
      } else {
        const directory = path.join(UPLOAD_FILE_PATH, BKEMO_BACKUP_PREFIX);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const targetFile = path.join(directory, archive.filename);
        await writeFile(targetFile, archive.buffer, { mode: 0o600 });
        const retained = await pruneLocalBackups(directory);
        result = {
          filePath: `/api/file/${BKEMO_BACKUP_PREFIX}/${archive.filename}`,
          filename: archive.filename,
          scope: archive.scope,
          storage: 'local',
          bytes: archive.buffer.length,
          completedAt: new Date().toISOString(),
          retained,
        };
      }

      await saveStatus(result);
      await CreateNotification({
        type: NotificationType.SYSTEM,
        title: 'system-notification',
        content: 'backup-success',
        useAdmin: true,
      });
      return result;
    } catch (error: any) {
      await saveStatus({
        error: error?.message ?? 'Scheduled backup failed',
        completedAt: new Date().toISOString(),
      }).catch(() => undefined);
      throw error;
    }
  }
}
