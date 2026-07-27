import { router, authProcedure, publicProcedure, demoAuthMiddleware, requireManageSite, superAdminAuthMiddleware } from '../middleware';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { prisma } from '../prisma';
import { GlobalConfig, ZConfigKey, ZConfigSchema, ZUserPerferConfigKey } from '../../shared/lib/types';
import { configSchema } from '@shared/lib/prismaZodType';
import { Context } from '../context';
import { reinitializeOAuthStrategies } from '../routerExpress/auth/config';
import { resolvePermissions } from '../lib/permissions';
import { normalizeStorageSettings, testStorageConnection, type StorageSettings } from '../lib/storageConnection';
import { recordStorageActivity } from '../lib/storageActivity';
import { decryptStorageCredential, encryptStorageCredential } from '../lib/storageCredentialEncryption';
import { verifyActiveSetup } from '../lib/activeSetupVerification';
import { fetchNeonCuUsage } from '../lib/neonCuUsage';

const storageSettingsSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('local'),
    localCustomPath: z.string().max(512).optional(),
  }),
  z.object({
    provider: z.literal('s3'),
    endpoint: z.string().max(2048).optional(),
    region: z.string().max(128),
    bucket: z.string().max(255),
    accessKeyId: z.string().max(1024).optional(),
    secretAccessKey: z.string().max(4096).optional(),
    prefix: z.string().max(512).optional(),
    forcePathStyle: z.boolean().optional(),
  }),
]);

const neonCuSettingsSchema = z.object({
  orgId: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/, 'Invalid Neon organization ID'),
  projectId: z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Invalid Neon project ID'),
  apiKey: z.string().trim().max(512).optional(),
});

function storageConfigEntries(settings: StorageSettings): Array<[string, unknown]> {
  if (settings.provider === 'local') {
    return [
      ['objectStorage', 'local'],
      ['localCustomPath', settings.localCustomPath ?? ''],
    ];
  }
  return [
    ['objectStorage', 's3'],
    ['s3Endpoint', settings.endpoint ?? ''],
    ['s3Region', settings.region],
    ['s3Bucket', settings.bucket],
    ['s3AccessKeyId', encryptStorageCredential(settings.accessKeyId ?? '')],
    ['s3AccessKeySecret', encryptStorageCredential(settings.secretAccessKey ?? '')],
    ['s3CustomPath', settings.prefix ?? ''],
    ['s3ForcePathStyle', settings.forcePathStyle !== false],
  ];
}

async function withStoredStorageCredentials(settings: StorageSettings): Promise<StorageSettings> {
  if (settings.provider !== 's3') return settings;

  const accessKeyId = settings.accessKeyId?.trim() ?? '';
  const secretAccessKey = settings.secretAccessKey?.trim() ?? '';
  if (accessKeyId || secretAccessKey) return settings;

  const stored = await getGlobalConfig({ useAdmin: true });
  return {
    ...settings,
    accessKeyId: stored.s3AccessKeyId || undefined,
    secretAccessKey: stored.s3AccessKeySecret || undefined,
  };
}

function maskedAccessKey(value: string) {
  if (!value) return '';
  const visible = value.slice(-4);
  return `${'*'.repeat(Math.max(8, Math.min(20, value.length - visible.length)))}${visible}`;
}

function storageConnectionError(error: unknown): TRPCError {
  const message = error instanceof Error ? error.message : 'Storage connection failed';
  return new TRPCError({ code: 'BAD_REQUEST', message });
}

let activeSetupVerification: ReturnType<typeof verifyActiveSetup> | null = null;
let neonCuUsageCache: { expiresAt: number; value: Awaited<ReturnType<typeof fetchNeonCuUsage>> } | null = null;

async function neonCuCredentials() {
  const rows = await prisma.config.findMany({
    where: { key: { in: ['neonOrgId', 'neonProjectId', 'neonApiKey'] }, userId: null },
    orderBy: { id: 'desc' },
  });
  const values = new Map<string, string>();
  for (const row of rows) {
    if (values.has(row.key)) continue;
    const config = row.config as { value?: unknown } | null;
    values.set(row.key, String(config?.value ?? ''));
  }
  const storedApiKey = values.get('neonApiKey') || '';
  return {
    orgId: values.get('neonOrgId') || process.env.NEON_ORG_ID || '',
    projectId: values.get('neonProjectId') || process.env.NEON_PROJECT_ID || '',
    apiKey: storedApiKey ? decryptStorageCredential(storedApiKey) : process.env.NEON_API_KEY || '',
    stored: Boolean(values.get('neonOrgId') || values.get('neonProjectId') || storedApiKey),
  };
}

async function activeStorageSettings(): Promise<StorageSettings> {
  const stored = await getGlobalConfig({ useAdmin: true });
  if (stored.objectStorage !== 's3') {
    return { provider: 'local', localCustomPath: stored.localCustomPath };
  }
  return {
    provider: 's3',
    endpoint: stored.s3Endpoint,
    region: stored.s3Region || 'auto',
    bucket: stored.s3Bucket || '',
    accessKeyId: stored.s3AccessKeyId,
    secretAccessKey: stored.s3AccessKeySecret,
    prefix: stored.s3CustomPath,
    forcePathStyle: stored.s3ForcePathStyle !== false,
  };
}

export const getGlobalConfig = async ({ ctx, useAdmin = false }: { ctx?: Context, useAdmin?: boolean }) => {
  const userId = Number(ctx?.id ?? 0);
  const configs = await prisma.config.findMany();
  // "Site admins" (owner or a user with admin power) may read global config so
  // they can edit it; everyone else only sees their own per-user prefs.
  let isSuperAdmin = useAdmin;
  if (!isSuperAdmin && userId) {
    const account = await prisma.accounts.findUnique({ where: { id: userId }, select: { role: true, permissions: true } });
    isSuperAdmin = resolvePermissions(account).manageSiteSettings;
  }

  const globalConfig = configs.reduce((acc, item) => {
    const config = item.config as { type: string, value: any };
    //If not login return the frist config
    if (
      item.key == 'isCloseBackgroundAnimation'
      || item.key == 'isAllowRegister'
      || item.key == 'language'
      || item.key == 'theme'
      || item.key == 'themeColor'
      || item.key == 'themeForegroundColor'
      || item.key == 'fontStyle'
      || item.key == 'maxHomePageWidth'
      || item.key == 'customBackgroundUrl'
      || item.key == 'hidePcEditor'
      || item.key == 'signinFooterEnabled'
      || item.key == 'signinFooterText'
      || item.key == 'customTitle'
    ) {
      //if user not login, then use frist find config
      if (!userId) {
        acc[item.key] = config.value;
        return acc;
      }
    }
    if (!isSuperAdmin && !item.userId) {
      return acc;
    }
    const isUserPreferConfig = ZUserPerferConfigKey.safeParse(item.key).success;
    if ((isUserPreferConfig && item.userId === userId) || (!isUserPreferConfig)) {
      acc[item.key] = config.value;
    }
    return acc;
  }, {} as Record<string, any>);

  if (globalConfig.s3AccessKeyId) globalConfig.s3AccessKeyId = decryptStorageCredential(globalConfig.s3AccessKeyId);
  if (globalConfig.s3AccessKeySecret) globalConfig.s3AccessKeySecret = decryptStorageCredential(globalConfig.s3AccessKeySecret);

  if (!useAdmin) {
    const savedAccessKey = String(globalConfig.s3AccessKeyId ?? '');
    const savedSecret = String(globalConfig.s3AccessKeySecret ?? '');
    const hasAccessKey = Boolean(savedAccessKey);
    const hasSecretKey = Boolean(savedSecret);
    delete globalConfig.s3AccessKeyId;
    delete globalConfig.s3AccessKeySecret;
    delete globalConfig.neonApiKey;
    delete globalConfig.scheduledBackupPassphrase;
    globalConfig.s3CredentialsConfigured = hasAccessKey && hasSecretKey;
    globalConfig.s3AccessKeyIdMasked = hasAccessKey ? maskedAccessKey(savedAccessKey) : '';
    globalConfig.s3SecretAccessKeyMasked = hasSecretKey ? '****************' : '';
  }

  return globalConfig as GlobalConfig;
};

export const getAiModelConfig = async (type: 'mainModel' | 'embeddingModel' | 'voiceModel' | 'rerankModel' | 'imageModel' | 'audioModel', ctx?: Context) => {
  // Map type to config key
  const configKey = `${type}Id`;

  // Get global config to find the model ID
  const globalConfig = await getGlobalConfig({ ctx });
  const modelId = globalConfig[configKey];

  if (!modelId) {
    return null;
  }

  // Get the model with provider information directly from prisma
  const model = await prisma.aiModels.findUnique({
    where: { id: modelId },
    include: { provider: true }
  });

  if (!model) {
    return null;
  }

  return {
    title: model.title,
    modelKey: model.modelKey,
    capabilities: model.capabilities,
    provider: {
      id: model.provider.id,
      title: model.provider.title,
      provider: model.provider.provider,
      baseURL: model.provider.baseURL,
      apiKey: model.provider.apiKey
    }
  };
};

export const configRouter = router({
  list: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/v1/config/list', summary: 'Query user config list', protect: true, tags: ['Config'] } })
    .input(z.void())
    .output(ZConfigSchema)
    .query(async function ({ ctx }) {
      return await getGlobalConfig({ ctx })
    }),
  neonCuSettings: authProcedure
    .use(demoAuthMiddleware)
    .use(superAdminAuthMiddleware)
    .input(z.void())
    .query(async () => {
      const settings = await neonCuCredentials();
      return {
        orgId: settings.orgId,
        projectId: settings.projectId,
        apiKeyConfigured: Boolean(settings.apiKey),
        storedInPortal: settings.stored,
      };
    }),
  saveNeonCuSettings: authProcedure
    .use(demoAuthMiddleware)
    .use(superAdminAuthMiddleware)
    .input(neonCuSettingsSchema)
    .mutation(async ({ input }) => {
      const current = await neonCuCredentials();
      const apiKey = input.apiKey || current.apiKey;
      if (!apiKey) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Enter a Neon API key' });
      const entries: Array<[string, string]> = [
        ['neonOrgId', input.orgId],
        ['neonProjectId', input.projectId],
        ['neonApiKey', encryptStorageCredential(apiKey)],
      ];
      await prisma.$transaction(async (tx) => {
        for (const [key, value] of entries) {
          await tx.config.deleteMany({ where: { key, userId: null } });
          await tx.config.create({ data: { key, config: { type: 'string', value } } });
        }
      });
      neonCuUsageCache = null;
      return { ok: true };
    }),
  clearNeonCuSettings: authProcedure
    .use(demoAuthMiddleware)
    .use(superAdminAuthMiddleware)
    .input(z.void())
    .mutation(async () => {
      await prisma.config.deleteMany({
        where: { key: { in: ['neonOrgId', 'neonProjectId', 'neonApiKey'] }, userId: null },
      });
      neonCuUsageCache = null;
      return { ok: true };
    }),
  neonCuUsage: authProcedure
    .use(demoAuthMiddleware)
    .use(superAdminAuthMiddleware)
    .input(z.void())
    .query(async () => {
      if (neonCuUsageCache && neonCuUsageCache.expiresAt > Date.now()) return neonCuUsageCache.value;
      try {
        const settings = await neonCuCredentials();
        const value = await fetchNeonCuUsage(settings);
        neonCuUsageCache = { value, expiresAt: Date.now() + 5 * 60_000 };
        return value;
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message: error instanceof Error ? error.message : 'Could not load Neon CU usage',
        });
      }
    }),
  update: authProcedure
    .meta({ openapi: { method: 'POST', path: '/v1/config/update', summary: 'Update user config', protect: true, tags: ['Config'] } })
    .input(z.object({
      key: ZConfigKey,
      value: z.any()
    }))
    .output(configSchema)
    .mutation(async function ({ input, ctx }) {
      const userId = Number(ctx.id)
      const { key, value } = input
      const isUserPreferConfig = ZUserPerferConfigKey.safeParse(key).success;
      console.log('isUserPreferConfig', isUserPreferConfig)
      let updateResult;
      
      if (isUserPreferConfig) {
        const matchedConfigs = await prisma.config.findMany({ where: { userId, key } });
        
        if (matchedConfigs.length > 0) {
          const configToKeep = matchedConfigs[0];
          updateResult = await prisma.config.update({ 
            where: { id: configToKeep?.id }, 
            data: { config: { type: typeof value, value } } 
          });
          
          if (matchedConfigs.length > 1) {
            await prisma.config.deleteMany({
              where: {
                userId,
                key,
                id: { notIn: [configToKeep!.id!] }
              }
            });
          }
        } else {
          updateResult = await prisma.config.create({ data: { userId, key, config: { type: typeof value, value } } });
        }
      } else {
        // Global (site) config requires the "admin power" permission.
        const account = await prisma.accounts.findUnique({ where: { id: userId }, select: { role: true, permissions: true } });
        if (!resolvePermissions(account).manageSiteSettings) {
          throw new Error('You are not allowed to update global config')
        }
        const matchedConfigs = await prisma.config.findMany({ where: { key } });
        
        if (matchedConfigs.length > 0) {
          const configToKeep = matchedConfigs[0];
          updateResult = await prisma.config.update({ 
            where: { id: configToKeep?.id }, 
            data: { config: { type: typeof value, value } } 
          });
          
          if (matchedConfigs.length > 1) {
            await prisma.config.deleteMany({
              where: {
                key,
                id: { notIn: [configToKeep!.id!] }
              }
            });
          }
        } else {
          updateResult = await prisma.config.create({ data: { key, config: { type: typeof value, value } } });
        }
      }

      // If updating OAuth2 providers, reinitialize OAuth strategies
      if (key === 'oauth2Providers') {
        try {
          const result = await reinitializeOAuthStrategies();
          console.log('OAuth strategies reinitialized after config update:', result);
        } catch (error) {
          console.error('Failed to reinitialize OAuth strategies after config update:', error);
          // Don't throw error here to avoid breaking the config update
        }
      }

      return updateResult;
    }),

  testStorage: authProcedure
    .use(demoAuthMiddleware)
    .use(requireManageSite)
    .input(storageSettingsSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await testStorageConnection(await withStoredStorageCredentials(input));
        await recordStorageActivity({
          category: 'attachment-provider',
          action: 'connection-test',
          status: 'completed',
          destination: input.provider,
          summary: result.message,
          requestedById: Number(ctx.id),
          details: { location: result.location },
        });
        return result;
      } catch (error) {
        await recordStorageActivity({
          category: 'attachment-provider',
          action: 'connection-test',
          status: 'failed',
          destination: input.provider,
          summary: error instanceof Error ? error.message : 'Storage connection failed',
          requestedById: Number(ctx.id),
        });
        throw storageConnectionError(error);
      }
    }),

  verifyActiveSetup: authProcedure
    .use(demoAuthMiddleware)
    .use(superAdminAuthMiddleware)
    .input(z.void())
    .mutation(async ({ ctx }) => {
      if (activeSetupVerification) throw new TRPCError({ code: 'CONFLICT', message: 'Active setup verification is already running' });
      const operation = verifyActiveSetup({
        databaseUrl: process.env.DATABASE_URL,
        queryDatabase: async () => {
          const rows = await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
          return { database: rows[0]?.database || 'unknown' };
        },
        loadStorageSettings: activeStorageSettings,
        testStorage: testStorageConnection,
      });
      activeSetupVerification = operation;
      try {
        const result = await operation;
        await recordStorageActivity({
          category: 'active-setup',
          action: 'verify-active-setup',
          status: result.ok ? 'completed' : 'failed',
          source: result.database.provider,
          destination: result.attachments.provider,
          summary: `Database ${result.database.ok ? 'healthy' : 'failed'}; attachments ${result.attachments.ok ? 'healthy' : 'failed'}`,
          requestedById: Number(ctx.id),
          details: {
            verifiedAt: result.verifiedAt,
            database: result.database,
            attachments: result.attachments,
          },
        });
        return result;
      } finally {
        if (activeSetupVerification === operation) activeSetupVerification = null;
      }
    }),

  saveStorage: authProcedure
    .use(demoAuthMiddleware)
    .use(requireManageSite)
    .input(storageSettingsSchema)
    .mutation(async ({ input, ctx }) => {
      const previous = await getGlobalConfig({ useAdmin: true });
      const source = previous.objectStorage === 's3' ? 's3' : 'local';
      try {
        const normalized = normalizeStorageSettings(await withStoredStorageCredentials(input));
        const connection = await testStorageConnection(normalized);
        const entries = storageConfigEntries(normalized);
        await prisma.$transaction(async (tx) => {
          for (const [key, value] of entries) {
            await tx.config.deleteMany({ where: { key } });
            await tx.config.create({ data: { key, config: { type: typeof value, value } } });
          }
        });
        await recordStorageActivity({
          category: 'attachment-provider',
          action: source === normalized.provider ? 'configuration-saved' : 'provider-activated',
          status: 'completed',
          source,
          destination: normalized.provider,
          summary: `${connection.message}. ${normalized.provider === 's3' ? 'S3/R2' : 'Local filesystem'} is active`,
          requestedById: Number(ctx.id),
          details: { location: connection.location },
        });
        return { ...connection, active: normalized.provider };
      } catch (error) {
        await recordStorageActivity({
          category: 'attachment-provider',
          action: 'provider-activation',
          status: 'failed',
          source,
          destination: input.provider,
          summary: error instanceof Error ? error.message : 'Storage provider activation failed',
          requestedById: Number(ctx.id),
        });
        throw storageConnectionError(error);
      }
    }),

  removeStorageCredentials: authProcedure
    .use(demoAuthMiddleware)
    .use(requireManageSite)
    .input(z.object({ confirmation: z.literal('REMOVE S3 CREDENTIALS') }))
    .mutation(async ({ ctx }) => {
      const current = await getGlobalConfig({ useAdmin: true });
      if (current.objectStorage === 's3') throw new Error('Switch attachments to local storage before removing the active S3 credentials');
      await prisma.$transaction(async (tx) => {
        for (const key of ['s3AccessKeyId', 's3AccessKeySecret']) {
          await tx.config.deleteMany({ where: { key } });
          await tx.config.create({ data: { key, config: { type: 'string', value: '' } } });
        }
      });
      await recordStorageActivity({
        category: 'attachment-provider', action: 'credentials-removed', status: 'completed',
        source: 's3', summary: 'Saved S3 credentials were removed', requestedById: Number(ctx.id),
      });
      return { ok: true };
    }),

  setPluginConfig: authProcedure
    .meta({ openapi: { method: 'POST', path: '/v1/config/setPluginConfig', summary: 'Set plugin config', protect: true, tags: ['Config'] } })
    .input(z.object({
      pluginName: z.string(),
      key: z.string(),
      value: z.any()
    }))
    .output(z.any())
    .mutation(async function ({ input, ctx }) {
      const userId = Number(ctx.id)
      const { pluginName, key, value } = input
      const hasKey = await prisma.config.findFirst({ where: { userId, key: `plugin_config_${pluginName}_${key}` } })
      if (hasKey) {
        return await prisma.config.update({ where: { id: hasKey.id }, data: { config: { type: typeof value, value } } })
      }
      return await prisma.config.create({ data: { userId, key: `plugin_config_${pluginName}_${key}`, config: { type: typeof value, value } } })
    }),
  getPluginConfig: authProcedure
    .meta({ openapi: { method: 'GET', path: '/v1/config/getPluginConfig', summary: 'Get plugin config', protect: true, tags: ['Config'] } })
    .input(z.object({
      pluginName: z.string()
    }))
    .output(z.any())
    .query(async function ({ input, ctx }) {
      const userId = Number(ctx.id)
      const { pluginName } = input
      const configs = await prisma.config.findMany({
        where: {
          userId,
          key: {
            contains: `plugin_config_${pluginName}_`
          }
        }
      })
      return configs.reduce((acc, item) => {
        const key = item.key.replace(`plugin_config_${pluginName}_`, '');
        acc[key] = (item.config as { value: any }).value;
        return acc;
      }, {} as Record<string, any>);
    }),

  ai: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/v1/config/ai', summary: 'Get AI model configuration by type', protect: true, tags: ['Config'] } })
    .input(z.object({
      type: z.enum(['mainModel', 'embeddingModel', 'voiceModel', 'rerankModel', 'imageModel', 'audioModel'])
    }))
    .output(z.object({
      title: z.string(),
      modelKey: z.string(),
      capabilities: z.any(),
      provider: z.object({
        id: z.number(),
        title: z.string(),
        provider: z.string(),
        baseURL: z.string().nullable(),
        apiKey: z.string().nullable()
      })
    }).nullable())
    .query(async function ({ input, ctx }) {
      const { type } = input;

      const model = await getAiModelConfig(type, ctx);
      return model;
    })
})
