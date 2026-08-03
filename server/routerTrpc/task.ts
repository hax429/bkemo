import { router, authProcedure, demoAuthMiddleware, requireManageSite } from '@server/middleware';
import { z } from 'zod';
import { BackupJob, BACKUP_STATUS_CACHE_KEY, SCHEDULE_TIMEZONES, hasScheduledBackupPassphrase } from '@server/jobs/backupJob';
import { ArchiveJob } from '@server/jobs/archivejob';
import {
  getWeeklyKnowledgeSettings,
  getWeeklyKnowledgeStatus,
  refreshWeeklyKnowledgeDocumentStatus,
  saveWeeklyKnowledgeSettings,
  testSavedWeeklyKnowledgeConnection,
  WEEKLY_KNOWLEDGE_DEFAULT_CRON,
  WeeklyKnowledgeJob,
} from '@server/jobs/weeklyKnowledgeJob';
import { exportMarkdownFiles } from '@server/jobs/exportMarkdownFiles';
import { UPLOAD_FILE_PATH } from '@shared/lib/pathConstant';
import { ARCHIVE_BLINKO_TASK_NAME, DBBAK_TASK_NAME, WEEKLY_KNOWLEDGE_TASK_NAME } from '@shared/lib/sharedConstant';
import { unlink } from 'fs/promises';
import { FileService } from '../lib/files';
import path from 'path';
import fs from 'fs';
import { prisma } from '../prisma';
import { TRPCError } from '@trpc/server';
import {
  exportBk,
  exportReadable,
  exportRecoveryKey,
  importRecoveryKey,
  importTransfer,
  previewImport,
} from '../lib/bkemoTransfer';
import { encryptStorageCredential } from '../lib/storageCredentialEncryption';

const taskInfoSchema = z.object({
  name: z.string(),
  schedule: z.string(),
  timezone: z.string().optional(),
  lastRun: z.date().nullable().optional(),
  isRunning: z.boolean(),
  output: z.any().optional(),
  hasPassphrase: z.boolean().optional(),
  hasApiKey: z.boolean().optional(),
  knowledgeBaseId: z.string().optional(),
});

const scheduleTimezoneSchema = z.enum(SCHEDULE_TIMEZONES);
const BACKUP_PASSPHRASE_CONFIG_KEY = 'scheduledBackupPassphrase';

async function assertOwnedTransferFile(filePath: string, accountId: number): Promise<void> {
  const storedPath = await FileService.resolveStoredPath(filePath);
  const attachment = await prisma.attachments.findFirst({ where: { path: storedPath, accountId }, select: { id: true } });
  if (!attachment) throw new TRPCError({ code: 'FORBIDDEN', message: 'The uploaded transfer file does not belong to this account' });
}

async function saveBackupPassphrase(passphrase: string): Promise<void> {
  if (passphrase.length < 8) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Backup passphrase must be at least 8 characters' });
  }
  const encrypted = encryptStorageCredential(passphrase);
  const payload = { type: 'string', value: encrypted };
  const existing = await prisma.config.findFirst({ where: { key: BACKUP_PASSPHRASE_CONFIG_KEY } });
  if (existing) {
    await prisma.config.update({ where: { id: existing.id }, data: { config: payload } });
  } else {
    await prisma.config.create({ data: { key: BACKUP_PASSPHRASE_CONFIG_KEY, config: payload } });
  }
}

export const taskRouter = router({
  weeklyKnowledgeSettings: authProcedure.use(requireManageSite)
    .input(z.void())
    .query(async () => {
      const settings = await getWeeklyKnowledgeSettings();
      return {
        apiKeyConfigured: settings.apiKeyConfigured,
        knowledgeBaseId: settings.knowledgeBaseId,
      };
    }),

  saveWeeklyKnowledgeSettings: authProcedure.use(requireManageSite)
    .input(z.object({
      apiKey: z.string().trim().max(512).optional(),
      knowledgeBaseId: z.string().trim().min(6).max(30),
    }))
    .mutation(async ({ input }) => {
      await saveWeeklyKnowledgeSettings(input);
      return { success: true };
    }),

  testWeeklyKnowledgeConnection: authProcedure.use(requireManageSite)
    .input(z.void())
    .mutation(async () => testSavedWeeklyKnowledgeConnection()),

  checkWeeklyKnowledgeStatus: authProcedure.use(requireManageSite)
    .input(z.void())
    .mutation(async () => refreshWeeklyKnowledgeDocumentStatus()),

  exportPortable: authProcedure.use(demoAuthMiddleware)
    .input(z.object({
      format: z.enum(['markdown', 'json', 'bk']),
      passphrase: z.string().optional(),
      scope: z.enum(['all', 'active', 'archived', 'trash']).default('active'),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .output(z.object({
      success: z.boolean(),
      downloadUrl: z.string(),
      filename: z.string(),
      fileCount: z.number().optional(),
      scope: z.enum(['account', 'site']).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.format === 'bk') {
        if (!input.passphrase) throw new TRPCError({ code: 'BAD_REQUEST', message: 'A passphrase is required for .bk exports' });
        const result = await exportBk(ctx, input.passphrase);
        return { success: true, downloadUrl: result.downloadUrl, filename: result.filename, scope: result.scope };
      }
      const result = await exportReadable(ctx, input.format, input);
      return { success: true, downloadUrl: result.downloadUrl, filename: result.filename, fileCount: result.fileCount };
    }),

  previewPortableImport: authProcedure.use(demoAuthMiddleware)
    .input(z.object({ filePath: z.string(), passphrase: z.string().optional() }))
    .output(z.object({
      format: z.enum(['bk', 'json', 'markdown']),
      scope: z.enum(['account', 'site']),
      notes: z.number(),
      attachments: z.number(),
      accounts: z.number(),
      canRestoreSharing: z.boolean(),
      canRestoreSiteSettings: z.boolean(),
      plainMarkdown: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertOwnedTransferFile(input.filePath, Number(ctx.id));
      const file = await FileService.getFile(input.filePath);
      try { return await previewImport(file.path, input.passphrase, ctx); }
      finally { if (file.isTemporary) await file.cleanup?.(); }
    }),

  importPortable: authProcedure.use(demoAuthMiddleware)
    .input(z.object({
      filePath: z.string(),
      passphrase: z.string().optional(),
      mode: z.enum(['merge', 'replace']).default('merge'),
      preserveSharing: z.boolean().default(false),
      restoreSiteSettings: z.boolean().default(false),
    }))
    .output(z.object({
      created: z.number(),
      updated: z.number(),
      conflicts: z.number(),
      skipped: z.number(),
      warnings: z.array(z.string()),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertOwnedTransferFile(input.filePath, Number(ctx.id));
      const file = await FileService.getFile(input.filePath);
      try {
        return await importTransfer(file.path, input.passphrase, ctx, input);
      } finally {
        if (file.isTemporary) await file.cleanup?.();
        await FileService.deleteFile(input.filePath).catch(() => undefined);
      }
    }),

  exportRecoveryKey: authProcedure.use(demoAuthMiddleware).use(requireManageSite)
    .input(z.object({ passphrase: z.string() }))
    .output(z.object({ success: z.boolean(), downloadUrl: z.string(), filename: z.string() }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.role !== 'superadmin') throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the first superadmin can export the recovery key' });
      const result = await exportRecoveryKey(Number(ctx.id), input.passphrase);
      return { success: true, downloadUrl: result.downloadUrl, filename: result.filename };
    }),

  importRecoveryKey: authProcedure.use(demoAuthMiddleware).use(requireManageSite)
    .input(z.object({ filePath: z.string(), passphrase: z.string() }))
    .output(z.object({ success: z.boolean(), siteId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.role !== 'superadmin') throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the first superadmin can import the recovery key' });
      await assertOwnedTransferFile(input.filePath, Number(ctx.id));
      const file = await FileService.getFile(input.filePath);
      try { return { success: true, siteId: await importRecoveryKey(Number(ctx.id), file.path, input.passphrase) }; }
      finally {
        if (file.isTemporary) await file.cleanup?.();
        await FileService.deleteFile(input.filePath).catch(() => undefined);
      }
    }),

  list: authProcedure.use(requireManageSite)
    .meta({ openapi: { method: 'GET', path: '/v1/tasks/list', summary: 'Query user task list', protect: true, tags: ['Task'] } })
    .input(z.void())
    .output(z.array(taskInfoSchema))
    .query(async () => {
      const [schedules, passphraseReady, backupStatus, weeklySettings, weeklyStatus] = await Promise.all([
        prisma.systemSchedule.findMany({
          where: { name: { in: [ARCHIVE_BLINKO_TASK_NAME, DBBAK_TASK_NAME, WEEKLY_KNOWLEDGE_TASK_NAME] } },
        }),
        hasScheduledBackupPassphrase(),
        prisma.cache.findUnique({ where: { key: BACKUP_STATUS_CACHE_KEY } }),
        getWeeklyKnowledgeSettings(),
        getWeeklyKnowledgeStatus(),
      ]);
      const byName = new Map(schedules.map((schedule) => [schedule.name, schedule]));

      return [ARCHIVE_BLINKO_TASK_NAME, DBBAK_TASK_NAME, WEEKLY_KNOWLEDGE_TASK_NAME].map((name) => {
        const schedule = byName.get(name);
        return {
          name,
          schedule: schedule?.cron ?? (name === WEEKLY_KNOWLEDGE_TASK_NAME ? WEEKLY_KNOWLEDGE_DEFAULT_CRON : '0 0 * * *'),
          timezone: schedule?.timezone ?? (name === WEEKLY_KNOWLEDGE_TASK_NAME ? 'America/New_York' : 'UTC'),
          lastRun: schedule?.lastRunAt ?? null,
          isRunning: schedule?.enabled ?? false,
          output: name === DBBAK_TASK_NAME
            ? (backupStatus?.value ?? schedule?.lastOutput ?? null)
            : name === WEEKLY_KNOWLEDGE_TASK_NAME
              ? (weeklyStatus ?? schedule?.lastOutput ?? null)
              : (schedule?.lastOutput ?? null),
          hasPassphrase: name === DBBAK_TASK_NAME ? passphraseReady : undefined,
          hasApiKey: name === WEEKLY_KNOWLEDGE_TASK_NAME ? weeklySettings.apiKeyConfigured : undefined,
          knowledgeBaseId: name === WEEKLY_KNOWLEDGE_TASK_NAME ? weeklySettings.knowledgeBaseId : undefined,
        };
      });
    }),

  upsertTask: authProcedure.use(requireManageSite)
    .meta({ openapi: { method: 'GET', path: '/v1/tasks/upsert', summary: 'Upsert Task', protect: true, tags: ['Task'] } })
    .input(z.object({
      time: z.string().optional(),
      timezone: scheduleTimezoneSchema.optional(),
      passphrase: z.string().optional(),
      type: z.enum(['start', 'stop', 'update', 'runNow']),
      task: z.enum([ARCHIVE_BLINKO_TASK_NAME, DBBAK_TASK_NAME, WEEKLY_KNOWLEDGE_TASK_NAME]),
    }))
    .output(z.any())
    .mutation(async ({ input }) => {
      const { time, type, task, timezone, passphrase } = input;
      const tz = timezone ?? 'UTC';

      if (passphrase) {
        if (task !== DBBAK_TASK_NAME) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Passphrase only applies to scheduled .bk backup' });
        }
        await saveBackupPassphrase(passphrase);
      }

      if (type === 'runNow') {
        if (task === DBBAK_TASK_NAME) {
          if (!(await hasScheduledBackupPassphrase())) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Set a backup passphrase before running' });
          }
          await BackupJob.TriggerNow();
        } else if (task === WEEKLY_KNOWLEDGE_TASK_NAME) {
          await WeeklyKnowledgeJob.TriggerNow();
        } else {
          await ArchiveJob.TriggerNow();
        }
        return { success: true, action: 'runNow' };
      }

      if (type === 'start') {
        const cronTime = time ?? '0 0 * * *';
        if (task === DBBAK_TASK_NAME) {
          if (!(await hasScheduledBackupPassphrase())) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Set a backup passphrase before enabling scheduled backup' });
          }
          await BackupJob.Start(cronTime, true, tz);
        } else if (task === WEEKLY_KNOWLEDGE_TASK_NAME) {
          const settings = await getWeeklyKnowledgeSettings();
          if (!settings.apiKeyConfigured || !settings.knowledgeBaseId) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Save BigModel settings before enabling weekly export' });
          }
          await WeeklyKnowledgeJob.Start(cronTime, false, tz);
        } else {
          await ArchiveJob.Start(cronTime, true, tz);
        }
        return { success: true, action: 'started', cron: cronTime, timezone: tz };
      }

      if (type === 'stop') {
        if (task === DBBAK_TASK_NAME) {
          await BackupJob.Stop();
        } else if (task === WEEKLY_KNOWLEDGE_TASK_NAME) {
          await WeeklyKnowledgeJob.Stop();
        } else {
          await ArchiveJob.Stop();
        }
        return { success: true, action: 'stopped' };
      }

      if (type === 'update' && time) {
        if (task === DBBAK_TASK_NAME) {
          await BackupJob.SetCronTime(time, timezone);
        } else if (task === WEEKLY_KNOWLEDGE_TASK_NAME) {
          await WeeklyKnowledgeJob.SetCronTime(time, timezone);
        } else {
          await ArchiveJob.SetCronTime(time, timezone);
        }
        return { success: true, action: 'updated', cron: time, timezone: tz };
      }

      if (type === 'update' && passphrase && task === DBBAK_TASK_NAME) {
        return { success: true, action: 'passphrase-updated' };
      }

      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid task update' });
    }),

  importFromMemos: authProcedure.use(demoAuthMiddleware).use(requireManageSite)
    .input(z.object({
      filePath: z.string(),
    }))
    .mutation(async function* ({ input, ctx }) {
      try {
        const { Memos } = await import('../jobs/memosJob');
        const memos = new Memos();
        await memos.initDB(input.filePath);
        for await (const result of memos.importMemosDB(ctx)) {
          yield result;
        }
        for await (const result of memos.importFiles(ctx)) {
          yield result;
        }
        await memos.closeDB();
        try {
          await FileService.deleteFile(input.filePath);
        } catch {
          // ignore cleanup
        }
      } catch (error) {
        throw new Error(error as string);
      }
    }),

  importFromMarkdown: authProcedure.use(demoAuthMiddleware)
    .input(z.object({
      filePath: z.string(),
    }))
    .mutation(async function* ({ input, ctx }) {
      try {
        const fileResult = await FileService.getFile(input.filePath);
        const { MarkdownImporter } = await import('../jobs/markdownJob');
        const markdownImporter = new MarkdownImporter();

        for await (const result of markdownImporter.importMarkdown(fileResult.path, ctx)) {
          yield result;
        }

        try {
          if (fileResult.isTemporary && fileResult.cleanup) {
            await fileResult.cleanup();
          } else {
            await unlink(fileResult.path);
          }
          await FileService.deleteFile(input.filePath);
        } catch (error) {
          console.error('Failed to clean up files after markdown import:', error);
        }
      } catch (error) {
        console.error('Error in importFromMarkdown:', error);
        throw new Error(error as string);
      }
    }),

  exportMarkdown: authProcedure
    .input(z.object({
      format: z.enum(['markdown', 'csv', 'json']),
      baseURL: z.string(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    })).output(z.object({
      success: z.boolean(),
      downloadUrl: z.string().optional(),
      fileCount: z.number().optional(),
      error: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await exportMarkdownFiles({ ...input, ctx });
      setTimeout(async () => {
        try {
          const zipPath = path.join(UPLOAD_FILE_PATH, result.path);
          if (fs.existsSync(zipPath)) {
            await unlink(zipPath);
          }
        } catch (error) {
          console.warn('Failed to cleanup export zip file:', error);
        }
      }, 5 * 60 * 1000);
      return {
        success: true,
        downloadUrl: `/api/file${result.path}`,
        fileCount: result.fileCount,
      };
    }),
});
