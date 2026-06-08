import { z } from 'zod';
import { randomUUID } from 'crypto';
import { TRPCError } from '@trpc/server';
import { router, authProcedure } from '../middleware';
import { prisma } from '../prisma';
import { generateAccessToken } from '../lib/helper';
import { expandScopes, sanitizeScopes, publicScopeCatalogue } from '../../shared/lib/accessTokenScopes';

const tokenSummary = z.object({
  id: z.number(),
  name: z.string(),
  scopes: z.array(z.string()),
  preview: z.string(),
  lastUsedAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  createdAt: z.date(),
});

/**
 * Named, scope-limited API access tokens (Settings → Security & API). The bearer
 * credential is a JWT carrying the expanded permission paths; rows here let the
 * owner list/revoke their tokens. The full token is returned exactly once, on
 * creation — afterwards only a `preview` (last 6 chars) is stored/shown.
 */
export const accessTokenRouter = router({
  scopes: authProcedure
    .meta({ openapi: { method: 'GET', path: '/v1/access-token/scopes', summary: 'List available API token scopes', protect: true, tags: ['AccessToken'] } })
    .input(z.void())
    .output(z.array(z.object({ id: z.string(), label: z.string(), description: z.string() })))
    .query(() => publicScopeCatalogue()),

  list: authProcedure
    .meta({ openapi: { method: 'GET', path: '/v1/access-token/list', summary: 'List my access tokens', protect: true, tags: ['AccessToken'] } })
    .input(z.void())
    .output(z.array(tokenSummary))
    .query(async ({ ctx }) => {
      const accountId = Number((ctx as any).id);
      const rows = await prisma.accessToken.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' } });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        scopes: sanitizeScopes((r.scopes as string[] | null) ?? []),
        preview: r.preview,
        lastUsedAt: r.lastUsedAt,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
      }));
    }),

  create: authProcedure
    .meta({ openapi: { method: 'POST', path: '/v1/access-token/create', summary: 'Create an access token', protect: true, tags: ['AccessToken'] } })
    .input(z.object({
      name: z.string().trim().min(1).max(80),
      scopes: z.array(z.string()).min(1),
      expiresInDays: z.number().int().positive().max(36500).nullable().optional(),
    }))
    .output(z.object({ id: z.number(), name: z.string(), scopes: z.array(z.string()), token: z.string(), preview: z.string(), expiresAt: z.date().nullable(), createdAt: z.date() }))
    .mutation(async ({ ctx, input }) => {
      const accountId = Number((ctx as any).id);
      const account = await prisma.accounts.findUnique({ where: { id: accountId } });
      if (!account) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });

      const scopes = sanitizeScopes(input.scopes);
      if (scopes.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No valid scopes selected' });

      const jti = randomUUID();
      const expSeconds = input.expiresInDays ? Math.floor(Date.now() / 1000) + input.expiresInDays * 86400 : undefined;
      const token = await generateAccessToken(
        { id: account.id, name: account.name, role: account.role },
        expandScopes(scopes),
        jti,
        expSeconds,
      );
      const preview = token.slice(-6);
      const row = await prisma.accessToken.create({
        data: {
          accountId,
          name: input.name,
          jti,
          scopes,
          preview,
          expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400000) : null,
        },
      });
      return { id: row.id, name: row.name, scopes, token, preview, expiresAt: row.expiresAt, createdAt: row.createdAt };
    }),

  revoke: authProcedure
    .meta({ openapi: { method: 'POST', path: '/v1/access-token/revoke', summary: 'Revoke an access token', protect: true, tags: ['AccessToken'] } })
    .input(z.object({ id: z.number() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const accountId = Number((ctx as any).id);
      // Scoped to the caller so one user can't revoke another's token.
      await prisma.accessToken.deleteMany({ where: { id: input.id, accountId } });
      return { success: true };
    }),
});
