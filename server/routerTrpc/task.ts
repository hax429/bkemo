import { router, authProcedure, demoAuthMiddleware, requireManageSite } from '@server/middleware';
import { z } from 'zod';
import { DBJob } from '@server/jobs/dbjob';
import { ArchiveJob } from '@server/jobs/archivejob';
import { UPLOAD_FILE_PATH } from '@shared/lib/pathConstant';
import { ARCHIVE_BLINKO_TASK_NAME, DBBAK_TASK_NAME } from '@shared/lib/sharedConstant';
import { Memos } from '../jobs/memosJob';
import { unlink } from 'fs/promises';
import { FileService } from '../lib/files';
import path from 'path';
import fs from 'fs';
import { MarkdownImporter } from '../jobs/markdownJob';
import { getPgBoss } from '../lib/pgBoss';
import { prisma } from '../prisma';
import { TRPCError } from '@trpc/server';
import {
  exportBk,
  exportReadable,
  exportRecoveryKey,
  importRecoveryKey,
  importTransfer,
  isFirstSuperadminAccount,
  previewImport,
} from '../lib/bkemoTransfer';

// Schema for task info compatible with frontend
const taskInfoSchema = z.object({
  name: z.string(),
  schedule: z.string(),
  lastRun: z.date().nullable().optional(),
  isRunning: z.boolean(),
  output: z.any().optional(),
});

// Cache keys for task outputs
const BACKUP_PROGRESS_CACHE_KEY = "backup-database-progress";

async function assertOwnedTransferFile(filePath: string, accountId: number): Promise<void> {
  const storedPath = await FileService.resolveStoredPath(filePath);
  const attachment = await prisma.attachments.findFirst({ where: { path: storedPath, accountId }, select: { id: true } });
  if (!attachment) throw new TRPCError({ code: 'FORBIDDEN', message: 'The uploaded transfer file does not belong to this account' });
}

export const taskRouter = router({
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
      const boss = await getPgBoss();
      const schedules = await boss.getSchedules();
      
      // Get last completed jobs for each scheduled task
      const results = await Promise.all(schedules.map(async (s) => {
        // Get the most recent completed job for this queue
        let lastRun: Date | null = null;
        let output: any = null;
        
        try {
          // Query pgboss.job table for the last completed job
          const lastJob = await prisma.$queryRaw<{ completed_on: Date | null }[]>`
            SELECT "completed_on" 
            FROM pgboss.job 
            WHERE name = ${s.name} AND state = 'completed'
            ORDER BY "completed_on" DESC 
            LIMIT 1
          `;
          
          if (lastJob.length > 0 && lastJob[0].completed_on) {
            lastRun = lastJob[0].completed_on;
          }
        } catch (e) {
          // pgboss tables might not exist yet, ignore
        }
        
        // Get output from cache for backup task
        if (s.name === DBBAK_TASK_NAME) {
          const cached = await prisma.cache.findUnique({
            where: { key: BACKUP_PROGRESS_CACHE_KEY }
          });
          if (cached?.value) {
            output = cached.value;
          }
        }
        
        return {
          name: s.name,
          schedule: s.cron,
          lastRun,
          isRunning: true, // If it's in schedules, it's running
          output,
        };
      }));
      
      return results;
    }),
  upsertTask: authProcedure.use(requireManageSite)
    .meta({ openapi: { method: 'GET', path: '/v1/tasks/upsert', summary: 'Upsert Task', protect: true, tags: ['Task'] } })
    .input(z.object({
      time: z.string().optional(),
      type: z.enum(['start', 'stop', 'update']),
      task: z.enum([ARCHIVE_BLINKO_TASK_NAME, DBBAK_TASK_NAME]),
    }))
    .output(z.any())
    .mutation(async ({ input }) => {
      const { time, type, task } = input
      if (type == 'start') {
        const cronTime = time ?? '0 0 * * *'
        if (task == DBBAK_TASK_NAME) {
          await DBJob.Start(cronTime, true);
        } else {
          await ArchiveJob.Start(cronTime, true);
        }
        return { success: true, action: 'started', cron: cronTime };
      }
      if (type == 'stop') {
        if (task == DBBAK_TASK_NAME) {
          await DBJob.Stop();
        } else {
          await ArchiveJob.Stop();
        }
        return { success: true, action: 'stopped' };
      }
      if (type == 'update' && time) {
        if (task == DBBAK_TASK_NAME) {
          await DBJob.SetCronTime(time);
        } else {
          await ArchiveJob.SetCronTime(time);
        }
        return { success: true, action: 'updated', cron: time };
      }
    }),
  importFromBlinko: authProcedure.use(demoAuthMiddleware).use(requireManageSite)
    .input(z.object({
      filePath: z.string()
    }))
    .mutation(async function* ({ input, ctx }) {
      if (!(await isFirstSuperadminAccount(Number(ctx.id)))) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the first superadmin can restore a full database backup' });
      }
      const { filePath } = input
      try {
        const fileResult = await FileService.getFile(filePath)
        const res = DBJob.RestoreDB(fileResult.path, ctx)
        for await (const result of res) {
          yield result;
        }
        try {
          if (fileResult.isTemporary && fileResult.cleanup) {
            await fileResult.cleanup()
          } else {
            await unlink(fileResult.path)
          }
          await FileService.deleteFile(filePath)
        } catch (error) {
        }
      } catch (error) {
        throw new Error(error as string)
      }
    }),

  importFromMemos: authProcedure.use(demoAuthMiddleware).use(requireManageSite)
    .input(z.object({
      filePath: z.string() //xxxx.db
    }))
    .mutation(async function* ({ input, ctx }) {
      try {
        const memos = new Memos();
        const dbPath = await memos.initDB(input.filePath);
        for await (const result of memos.importMemosDB(ctx)) {
          yield result;
        }
        for await (const result of memos.importFiles(ctx)) {
          yield result;
        }
        await memos.closeDB();
        try {
          await FileService.deleteFile(input.filePath)
        } catch (error) {
        }
      } catch (error) {
        throw new Error(error as string)
      }
    }),

  importFromMarkdown: authProcedure.use(demoAuthMiddleware)
    .input(z.object({
      filePath: z.string() // Path to .md file or .zip containing md files
    }))
    .mutation(async function* ({ input, ctx }) {
      try {
        const fileResult = await FileService.getFile(input.filePath);
        const markdownImporter = new MarkdownImporter();

        for await (const result of markdownImporter.importMarkdown(fileResult.path, ctx)) {
          yield result;
        }

        // Clean up the file after import
        try {
          if (fileResult.isTemporary && fileResult.cleanup) {
            await fileResult.cleanup()
          } else {
            await unlink(fileResult.path)
          }
          await FileService.deleteFile(input.filePath);
        } catch (error) {
          console.error("Failed to clean up files after markdown import:", error);
        }
      } catch (error) {
        console.error("Error in importFromMarkdown:", error);
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
      error: z.string().optional()
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await DBJob.ExporMDFiles({ ...input, ctx });
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
        fileCount: result.fileCount
      };
    }),
})
