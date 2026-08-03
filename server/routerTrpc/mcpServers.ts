import { router, authProcedure, requireManageSite } from '@server/middleware';
import { z } from 'zod';
import { prisma } from '@server/prisma';
import { mcpClientManager } from '@server/aiServer/mcp';
import { TRPCError } from '@trpc/server';
import { assertSafeOutboundUrl } from '@server/lib/safeOutboundUrl';
import { encryptStorageCredential } from '@server/lib/storageCredentialEncryption';

const BLOCKED_HEADERS = new Set([
  'connection',
  'content-length',
  'content-type',
  'cookie',
  'forwarded',
  'host',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
]);
const safeHeaders = z.record(
  z.string().regex(/^[A-Za-z0-9-]{1,100}$/),
  z.string().max(8192),
).superRefine((headers, ctx) => {
  for (const name of Object.keys(headers)) {
    if (BLOCKED_HEADERS.has(name.toLowerCase())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Header ${name} is not allowed` });
    }
  }
}).optional();
const mcpServerSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  type: z.literal('streamable-http'),
  command: z.null(),
  args: z.null(),
  url: z.string().nullable(),
  env: z.null(),
  headers: z.record(z.string(), z.string()).nullable(),
  allowedTools: z.array(z.string()),
  timeoutMs: z.number(),
  maxResultBytes: z.number(),
  isEnabled: z.boolean(),
  lastUsedAt: z.date().nullable(),
  lastStatus: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const connectionStatusSchema = z.object({
  serverId: z.number(),
  serverName: z.string(),
  isConnected: z.boolean(),
  toolCount: z.number(),
  lastUsed: z.date().optional(),
});

function encryptedHeaders(headers?: Record<string, string>) {
  if (!headers) return null;
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, encryptStorageCredential(value)]));
}

function present(server: any) {
  const headerKeys = server.headers && typeof server.headers === 'object' ? Object.keys(server.headers) : [];
  return {
    ...server,
    type: 'streamable-http' as const,
    command: null,
    args: null,
    env: null,
    headers: headerKeys.length ? Object.fromEntries(headerKeys.map((key) => [key, '••••••'])) : null,
    allowedTools: Array.isArray(server.allowedTools) ? server.allowedTools : [],
    lastError: server.lastError ? 'Connection failed; see server logs for the redacted diagnostic.' : null,
  };
}

async function requireSafeUrl(url: string) {
  const safe = await assertSafeOutboundUrl(url);
  if (!safe.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: safe.reason });
  if (safe.url.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Production MCP connectors require HTTPS' });
  }
}

const connectorInput = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().max(2000).optional(),
  type: z.literal('streamable-http').default('streamable-http'),
  url: z.string().url(),
  headers: safeHeaders,
  allowedTools: z.array(z.string().min(1).max(128)).max(100).default([]),
  timeoutMs: z.number().int().min(1000).max(120000).default(30000),
  maxResultBytes: z.number().int().min(1024).max(4 * 1024 * 1024).default(1024 * 1024),
  isEnabled: z.boolean().default(false),
});

export const mcpServersRouter = router({
  list: authProcedure.use(requireManageSite)
    .input(z.void()).output(z.array(mcpServerSchema))
    .query(async () => (await prisma.mcpServers.findMany({ orderBy: { createdAt: 'desc' } })).map(present)),

  get: authProcedure.use(requireManageSite)
    .input(z.object({ id: z.number() })).output(z.union([mcpServerSchema, z.null()]))
    .query(async ({ input }) => {
      const server = await prisma.mcpServers.findUnique({ where: { id: input.id } });
      return server ? present(server) : null;
    }),

  create: authProcedure.use(requireManageSite)
    .input(connectorInput).output(mcpServerSchema)
    .mutation(async ({ input }) => {
      await requireSafeUrl(input.url);
      const server = await prisma.mcpServers.create({
        data: {
          name: input.name,
          description: input.description || null,
          type: 'streamable-http',
          url: input.url,
          command: null,
          args: null,
          env: null,
          headers: encryptedHeaders(input.headers),
          allowedTools: input.allowedTools,
          timeoutMs: input.timeoutMs,
          maxResultBytes: input.maxResultBytes,
          secretsEncrypted: true,
          isEnabled: input.isEnabled,
        },
      });
      return present(server);
    }),

  update: authProcedure.use(requireManageSite)
    .input(connectorInput.partial().extend({ id: z.number() })).output(mcpServerSchema)
    .mutation(async ({ input }) => {
      const current = await prisma.mcpServers.findUnique({ where: { id: input.id } });
      if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'MCP server not found' });
      if (input.url) await requireSafeUrl(input.url);
      await mcpClientManager.disconnect(input.id);
      const server = await prisma.mcpServers.update({
        where: { id: input.id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.url !== undefined && { url: input.url }),
          ...(input.headers !== undefined && { headers: encryptedHeaders(input.headers), secretsEncrypted: true }),
          ...(input.allowedTools !== undefined && { allowedTools: input.allowedTools }),
          ...(input.timeoutMs !== undefined && { timeoutMs: input.timeoutMs }),
          ...(input.maxResultBytes !== undefined && { maxResultBytes: input.maxResultBytes }),
          ...(input.isEnabled !== undefined && { isEnabled: input.isEnabled }),
          type: 'streamable-http',
          command: null,
          args: null,
          env: null,
        },
      });
      return present(server);
    }),

  delete: authProcedure.use(requireManageSite)
    .input(z.object({ id: z.number() })).output(z.object({ success: z.boolean() }))
    .mutation(async ({ input }) => {
      await mcpClientManager.disconnect(input.id);
      await prisma.mcpServers.delete({ where: { id: input.id } });
      return { success: true };
    }),

  toggle: authProcedure.use(requireManageSite)
    .input(z.object({ id: z.number(), enabled: z.boolean() })).output(z.object({ success: z.boolean() }))
    .mutation(async ({ input }) => {
      if (input.enabled) {
        const current = await prisma.mcpServers.findUnique({ where: { id: input.id } });
        if (!current || current.type !== 'streamable-http' || !current.url) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only configured Streamable HTTP connectors can be enabled' });
        }
        await requireSafeUrl(current.url);
      }
      if (!input.enabled) await mcpClientManager.disconnect(input.id);
      await prisma.mcpServers.update({ where: { id: input.id }, data: { isEnabled: input.enabled, lastStatus: input.enabled ? 'idle' : 'disabled' } });
      return { success: true };
    }),

  emergencyDisable: authProcedure.use(requireManageSite)
    .input(z.void()).output(z.object({ success: z.boolean(), disabled: z.number() }))
    .mutation(async () => {
      await mcpClientManager.disconnectAll();
      const result = await prisma.mcpServers.updateMany({ where: { isEnabled: true }, data: { isEnabled: false, lastStatus: 'emergency-disabled' } });
      return { success: true, disabled: result.count };
    }),

  testConnection: authProcedure.use(requireManageSite)
    .input(z.object({ id: z.number() }))
    .output(z.object({ success: z.boolean(), toolCount: z.number().optional(), tools: z.array(z.object({ name: z.string(), description: z.string().optional() })).optional(), error: z.string().optional() }))
    .mutation(async ({ input }) => {
      try {
        const tools = await mcpClientManager.getTools(input.id, { allowDisabled: true, includeDisallowed: true });
        await mcpClientManager.disconnect(input.id);
        return { success: true, toolCount: tools.length, tools: tools.map(({ name, description }) => ({ name, description })) };
      } catch {
        await mcpClientManager.disconnect(input.id);
        return { success: false, error: 'Connection failed. Review the redacted server diagnostic.' };
      }
    }),

  connectionStatus: authProcedure.use(requireManageSite)
    .input(z.void()).output(z.array(connectionStatusSchema))
    .query(() => mcpClientManager.getConnectionStatus()),

  disconnect: authProcedure.use(requireManageSite)
    .input(z.object({ id: z.number() })).output(z.object({ success: z.boolean() }))
    .mutation(async ({ input }) => {
      await mcpClientManager.disconnect(input.id);
      return { success: true };
    }),

  getTools: authProcedure.use(requireManageSite)
    .input(z.void()).output(z.array(z.object({ name: z.string(), description: z.string().optional(), serverId: z.number(), serverName: z.string() })))
    .query(() => mcpClientManager.getAllEnabledTools()),
});
