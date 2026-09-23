import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { publicProcedure, router } from '../middleware';
import { prisma } from '../prisma';
import { configRouter, getGlobalConfig } from './config';
import { allowsSettingsAccess, allowsSettingsPath, needsRedactedGrant, settingsOperations, settingsConfig, isSettingsSecret, redactSettingsResult } from '../lib/nativeSettings';

// Introspection itself is available to any authenticated token. It grants no
// additional operation: capabilities are intersected with account permissions.
const settingsProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.name || !ctx.id || ctx.requiresTwoFactor) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const account = await prisma.accounts.findUnique({ where: { id: Number(ctx.id) }, select: { id: true, name: true, role: true, permissions: true } });
  if (!account || !allowsSettingsAccess(account, 'account')) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { ...ctx, settingsAccount: account } });
});
export const nativeSettingsRouter = router({
  snapshot: settingsProcedure
    .meta({ openapi: { method: 'GET', path: '/v1/native/settings', protect: true, tags: ['Config'], summary: 'Native settings capabilities and values' } })
    .input(z.void()).output(z.any())
    .query(async ({ ctx }): Promise<any> => {
      const { appRouter } = await import('./_app');
      const operations = settingsOperations.filter(op => allowsSettingsAccess(ctx.settingsAccount, op.access) && allowsSettingsPath(ctx.permissions, op.id))
        .map(op => {
          const procedure = (appRouter._def.procedures as Record<string, any>)[op.id];
          if (!procedure) throw new Error(`Unknown native settings operation: ${op.id}`);
          const input = procedure._def.inputs[0] as z.ZodType | undefined;
          return { ...op, mutation: procedure._def.type === 'mutation', input: input && input._def.type !== 'void' ? z.toJSONSchema(input, { unrepresentable: 'any', override: ({ zodSchema, jsonSchema }) => { if (zodSchema._zod.def.type === 'date') { jsonSchema.type = 'string'; jsonSchema.format = 'date-time'; } } }) : { type: 'null' } };
        });
      const canRead = allowsSettingsPath(ctx.permissions, 'config.list');
      const values = canRead ? await getGlobalConfig({ ctx }) : {};
      const config = canRead ? settingsConfig.filter(item => allowsSettingsAccess(ctx.settingsAccount, item.access)).map(item => ({
        key: item.key, section: item.section, title: item.title, secret: isSettingsSecret(item.key),
        writable: allowsSettingsPath(ctx.permissions, 'config.update'),
        schema: z.toJSONSchema(item.schema, { unrepresentable: 'any' }),
        value: isSettingsSecret(item.key) ? null : redactSettingsResult((values as any)[item.key]) ?? null,
        configured: isSettingsSecret(item.key) && Boolean((values as any)[item.key]),
      })) : [];
      return { version: 1, account: { id: ctx.settingsAccount.id, name: ctx.settingsAccount.name }, config, operations };
    }),
  perform: settingsProcedure
    .meta({ openapi: { method: 'POST', path: '/v1/native/settings/action', protect: true, tags: ['Config'], summary: 'Perform an authorized native settings action' } })
    .input(z.object({ operation: z.string(), input: z.any().optional(), confirmed: z.boolean().optional() })).output(z.any())
    .mutation(async ({ ctx, input }): Promise<any> => {
      if (input.operation === 'config.update') {
        const item = settingsConfig.find(item => item.key === input.input?.key);
        if (!item || !allowsSettingsAccess(ctx.settingsAccount, item.access) || !allowsSettingsPath(ctx.permissions, 'config.update')) throw new TRPCError({ code: 'FORBIDDEN' });
        const parsed = item.schema.safeParse(input.input.value);
        if (!parsed.success) throw new TRPCError({ code: 'BAD_REQUEST', message: parsed.error.issues.map(issue => issue.message).join('; ') });
        const value = parsed.data;
        await configRouter.createCaller(ctx).update({ key: item.key, value });
        return { success: true };
      }
      const operation = settingsOperations.find(op => op.id === input.operation);
      if (!operation || !allowsSettingsAccess(ctx.settingsAccount, operation.access) || !allowsSettingsPath(ctx.permissions, operation.id)) throw new TRPCError({ code: 'FORBIDDEN' });
      if (operation.destructive && input.confirmed !== true) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Confirm this action first.' });
      const { appRouter } = await import('./_app');
      const [namespace, name] = operation.id.split('.');
      // A redacted-read grant widens this one call only; the result is redacted below.
      const callCtx = needsRedactedGrant(ctx.permissions, operation.id) ? { ...ctx, permissions: [...ctx.permissions!, operation.id] } : ctx;
      const caller = appRouter.createCaller(callCtx) as any;
      // REST JSON represents the date inputs of portable export as ISO strings.
      const payload = input.input;
      if (operation.id === 'task.exportPortable' && payload) {
        for (const key of ['startDate', 'endDate']) if (typeof payload[key] === 'string') payload[key] = new Date(payload[key]);
      }
      const result = await caller[namespace!][name!](payload);
      // Only explicit credential creation may reveal a new secret, in memory.
      if (['accessTokens.create', 'users.generate2FASecret'].includes(operation.id)) return result;
      return redactSettingsResult(result) ?? { success: true };
    }),
});
