import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { authProcedure, router } from '../middleware';
import {
  issueObsidianPairingCode,
  listObsidianDevices,
  revokeObsidianDevice,
} from '../lib/obsidianPairing';
import { IntegrationError } from '../lib/integrationGateway';
import { redactIntegrationError } from '../lib/obsidianContracts';

function asTrpcError(error: unknown): never {
  if (error instanceof IntegrationError) {
    const redacted = error.toRedacted();
    const code =
      redacted.code === 'unauthorized' ? 'UNAUTHORIZED'
        : redacted.code === 'forbidden' ? 'FORBIDDEN'
          : redacted.code === 'not_found' ? 'NOT_FOUND'
            : 'BAD_REQUEST';
    throw new TRPCError({ code, message: redacted.message });
  }
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: redactIntegrationError('internal').message });
}

export const obsidianRouter = router({
  issuePairingCode: authProcedure
    .input(z.object({ deviceLabel: z.string().trim().max(80).optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      try {
        return await issueObsidianPairingCode({
          accountId: Number(ctx.id),
          deviceLabel: input?.deviceLabel,
        });
      } catch (error) {
        asTrpcError(error);
      }
    }),

  listDevices: authProcedure
    .input(z.void())
    .query(async ({ ctx }) => listObsidianDevices(Number(ctx.id))),

  revokeDevice: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => revokeObsidianDevice(Number(ctx.id), input.id)),
});