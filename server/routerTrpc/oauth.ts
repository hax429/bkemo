import { randomUUID } from 'crypto';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { authProcedure, router } from '../middleware';
import { prisma } from '../prisma';
import {
  MCP_AUTH_CODE_TTL_MS,
  mcpResourceUrl,
  randomOpaqueToken,
  sha256,
  validateAuthorizationRequest,
} from '../lib/mcpOAuth';

const authorizationInput = z.object({
  clientId: z.string().uuid(),
  redirectUri: z.string().url(),
  responseType: z.string(),
  codeChallenge: z.string(),
  codeChallengeMethod: z.string(),
  scope: z.string().optional(),
  resource: z.string().url(),
  state: z.string().max(2048).optional(),
});

export const oauthRouter = router({
  prepare: authProcedure
    .input(authorizationInput)
    .query(async ({ input }) => {
      try {
        const { client, scopes } = await validateAuthorizationRequest(input);
        return {
          clientName: client.clientName,
          clientUri: client.clientUri,
          logoUri: client.logoUri,
          scopes,
          resource: mcpResourceUrl(),
        };
      } catch (error) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: error instanceof Error ? error.message : 'invalid_request' });
      }
    }),

  approve: authProcedure
    .input(authorizationInput)
    .mutation(async ({ input, ctx }) => {
      try {
        const { scopes } = await validateAuthorizationRequest(input);
        const accountId = Number(ctx.id);
        const code = randomOpaqueToken();
        await prisma.$transaction([
          prisma.oauthConsent.upsert({
            where: { accountId_clientId: { accountId, clientId: input.clientId } },
            create: { id: randomUUID(), accountId, clientId: input.clientId, scopes },
            update: { scopes, revokedAt: null },
          }),
          prisma.oauthAuthorizationCode.create({
            data: {
              id: randomUUID(),
              codeHash: sha256(code),
              clientId: input.clientId,
              accountId,
              redirectUri: input.redirectUri,
              scopes,
              resource: input.resource,
              codeChallenge: input.codeChallenge,
              expiresAt: new Date(Date.now() + MCP_AUTH_CODE_TTL_MS),
            },
          }),
        ]);
        const redirect = new URL(input.redirectUri);
        redirect.searchParams.set('code', code);
        if (input.state) redirect.searchParams.set('state', input.state);
        return { redirectTo: redirect.toString() };
      } catch (error) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: error instanceof Error ? error.message : 'invalid_request' });
      }
    }),

  connections: authProcedure
    .input(z.void())
    .query(async ({ ctx }) => {
      return prisma.oauthConsent.findMany({
        where: { accountId: Number(ctx.id), revokedAt: null },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          scopes: true,
          createdAt: true,
          updatedAt: true,
          client: { select: { id: true, clientName: true, clientUri: true, logoUri: true } },
        },
      });
    }),

  revoke: authProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const accountId = Number(ctx.id);
      const now = new Date();
      await prisma.$transaction([
        prisma.oauthConsent.updateMany({ where: { accountId, clientId: input.clientId }, data: { revokedAt: now } }),
        prisma.oauthToken.updateMany({ where: { accountId, clientId: input.clientId, revokedAt: null }, data: { revokedAt: now } }),
      ]);
      return { success: true };
    }),
});
