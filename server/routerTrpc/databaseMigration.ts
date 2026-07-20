import { z } from 'zod';
import { authProcedure, demoAuthMiddleware, router, superAdminAuthMiddleware } from '../middleware';
import {
  cancelReadyDatabaseMigration,
  getDatabaseMigrationStatus,
  preflightDatabaseMigration,
  startDatabaseMigration,
} from '../lib/databaseMigration';

const guarded = authProcedure.use(demoAuthMiddleware).use(superAdminAuthMiddleware);

export const databaseMigrationRouter = router({
  status: guarded
    .input(z.object({ jobId: z.string().uuid().optional() }).optional())
    .query(({ input }) => getDatabaseMigrationStatus(input?.jobId)),

  preflight: guarded
    .input(z.object({ connectionString: z.string().min(1).max(4096), password: z.string().min(1).max(1024) }))
    .mutation(({ input, ctx }) => preflightDatabaseMigration(input.connectionString, Number(ctx.id), input.password)),

  start: guarded
    .input(z.object({
      connectionString: z.string().min(1).max(4096),
      password: z.string().min(1).max(1024),
      confirmHost: z.string().min(1).max(512),
      overrideQuota: z.boolean().optional(),
    }))
    .mutation(({ input, ctx }) => startDatabaseMigration(input, Number(ctx.id))),

  cancelReady: guarded
    .input(z.object({
      jobId: z.string().uuid(),
      password: z.string().min(1).max(1024),
      confirmation: z.string(),
    }))
    .mutation(({ input, ctx }) => cancelReadyDatabaseMigration(input.jobId, Number(ctx.id), input.password, input.confirmation)),
});
