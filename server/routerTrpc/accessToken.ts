import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authProcedure } from '../middleware';
import { prisma } from '../prisma';
import { publicScopeCatalogue } from '../../shared/lib/accessTokenScopes';
import {
  ACCESS_TOKEN_PLATFORMS,
  ACCESS_TOKEN_PLATFORM_LABELS,
  isAccessTokenPlatform,
} from '../../shared/lib/accessTokenPlatform';
import { mintManagedAccessToken } from '../lib/accessTokenService';

const platformSchema = z.enum(ACCESS_TOKEN_PLATFORMS);

const tokenSummary = z.object({
  id: z.number(),
  name: z.string(),
  platform: platformSchema,
  scopes: z.array(z.string()),
  preview: z.string(),
  lastUsedAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  createdAt: z.date(),
  hasOpenMisuse: z.boolean(),
});

const misuseSummary = z.object({
  id: z.string(),
  accessTokenId: z.number(),
  tokenName: z.string(),
  expectedPlatform: z.string(),
  observedPlatform: z.string(),
  requestCount: z.number(),
  lastSeenAt: z.date(),
  createdAt: z.date(),
});

/**
 * Named, scope-limited, platform-bound API access tokens (Settings → Security & API).
 * Full secret returned once on create; afterwards only preview + metadata.
 */
export const accessTokenRouter = router({
  scopes: authProcedure
    .meta({ openapi: { method: 'GET', path: '/v1/access-token/scopes', summary: 'List available API token scopes', protect: true, tags: ['AccessToken'] } })
    .input(z.void())
    .output(z.array(z.object({ id: z.string(), label: z.string(), description: z.string() })))
    .query(() => publicScopeCatalogue()),

  platforms: authProcedure
    .meta({ openapi: { method: 'GET', path: '/v1/access-token/platforms', summary: 'List access-token platforms', protect: true, tags: ['AccessToken'] } })
    .input(z.void())
    .output(z.array(z.object({ id: platformSchema, label: z.string() })))
    .query(() => ACCESS_TOKEN_PLATFORMS.map((id) => ({ id, label: ACCESS_TOKEN_PLATFORM_LABELS[id] }))),

  list: authProcedure
    .meta({ openapi: { method: 'GET', path: '/v1/access-token/list', summary: 'List my access tokens', protect: true, tags: ['AccessToken'] } })
    .input(z.void())
    .output(z.array(tokenSummary))
    .query(async ({ ctx }) => {
      const accountId = Number((ctx as any).id);
      const rows = await prisma.accessToken.findMany({
        where: { accountId },
        orderBy: { createdAt: 'desc' },
        include: {
          misuse: { where: { dismissedAt: null }, select: { id: true }, take: 1 },
        },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        platform: isAccessTokenPlatform(r.platform) ? r.platform : 'api',
        scopes: Array.isArray(r.scopes) ? (r.scopes as string[]) : [],
        preview: r.preview,
        lastUsedAt: r.lastUsedAt,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
        hasOpenMisuse: r.misuse.length > 0,
      }));
    }),

  create: authProcedure
    .meta({ openapi: { method: 'POST', path: '/v1/access-token/create', summary: 'Create an access token', protect: true, tags: ['AccessToken'] } })
    .input(z.object({
      name: z.string().trim().min(1).max(80),
      platform: platformSchema,
      scopes: z.array(z.string()).min(1),
      expiresInDays: z.number().int().positive().max(36500).nullable().optional(),
    }))
    .output(z.object({
      id: z.number(),
      name: z.string(),
      platform: platformSchema,
      scopes: z.array(z.string()),
      token: z.string(),
      preview: z.string(),
      expiresAt: z.date().nullable(),
      createdAt: z.date(),
    }))
    .mutation(async ({ ctx, input }) => {
      const accountId = Number((ctx as any).id);
      return mintManagedAccessToken({
        accountId,
        name: input.name,
        platform: input.platform,
        scopes: input.scopes,
        expiresInDays: input.expiresInDays,
      });
    }),

  revoke: authProcedure
    .meta({ openapi: { method: 'POST', path: '/v1/access-token/revoke', summary: 'Revoke an access token', protect: true, tags: ['AccessToken'] } })
    .input(z.object({ id: z.number() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const accountId = Number((ctx as any).id);
      await prisma.accessToken.deleteMany({ where: { id: input.id, accountId } });
      return { success: true };
    }),

  misuseIncidents: authProcedure
    .meta({ openapi: { method: 'GET', path: '/v1/access-token/misuse', summary: 'List open platform-mismatch incidents', protect: true, tags: ['AccessToken'] } })
    .input(z.void())
    .output(z.array(misuseSummary))
    .query(async ({ ctx }) => {
      const accountId = Number((ctx as any).id);
      const rows = await prisma.accessTokenMisuseIncident.findMany({
        where: { accountId, dismissedAt: null },
        orderBy: { lastSeenAt: 'desc' },
      });
      return rows.map((r) => ({
        id: r.id,
        accessTokenId: r.accessTokenId,
        tokenName: r.tokenName,
        expectedPlatform: r.expectedPlatform,
        observedPlatform: r.observedPlatform,
        requestCount: r.requestCount,
        lastSeenAt: r.lastSeenAt,
        createdAt: r.createdAt,
      }));
    }),

  dismissMisuse: authProcedure
    .meta({ openapi: { method: 'POST', path: '/v1/access-token/misuse/dismiss', summary: 'Dismiss a misuse incident', protect: true, tags: ['AccessToken'] } })
    .input(z.object({ id: z.string().uuid() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const accountId = Number((ctx as any).id);
      const updated = await prisma.accessTokenMisuseIncident.updateMany({
        where: { id: input.id, accountId, dismissedAt: null },
        data: { dismissedAt: new Date() },
      });
      if (updated.count === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Incident not found' });
      return { success: true };
    }),
});
