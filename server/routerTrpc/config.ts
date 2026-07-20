import { router, authProcedure, publicProcedure, demoAuthMiddleware, requireManageSite } from '../middleware';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { prisma } from '../prisma';
import { GlobalConfig, ZConfigKey, ZConfigSchema, ZUserPerferConfigKey } from '../../shared/lib/types';
import { configSchema } from '@shared/lib/prismaZodType';
import { Context } from '../context';
import { reinitializeOAuthStrategies } from '../routerExpress/auth/config';
import { resolvePermissions } from '../lib/permissions';
import { normalizeStorageSettings, testStorageConnection, type StorageSettings } from '../lib/storageConnection';

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
    ['s3AccessKeyId', settings.accessKeyId ?? ''],
    ['s3AccessKeySecret', settings.secretAccessKey ?? ''],
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

function storageConnectionError(error: unknown): TRPCError {
  const message = error instanceof Error ? error.message : 'Storage connection failed';
  return new TRPCError({ code: 'BAD_REQUEST', message });
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

  if (!useAdmin) {
    const hasAccessKey = Boolean(globalConfig.s3AccessKeyId);
    const hasSecretKey = Boolean(globalConfig.s3AccessKeySecret);
    delete globalConfig.s3AccessKeyId;
    delete globalConfig.s3AccessKeySecret;
    globalConfig.s3CredentialsConfigured = hasAccessKey && hasSecretKey;
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
    .mutation(async ({ input }) => {
      try {
        return await testStorageConnection(await withStoredStorageCredentials(input));
      } catch (error) {
        throw storageConnectionError(error);
      }
    }),

  saveStorage: authProcedure
    .use(demoAuthMiddleware)
    .use(requireManageSite)
    .input(storageSettingsSchema)
    .mutation(async ({ input }) => {
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
        return { ...connection, active: normalized.provider };
      } catch (error) {
        throw storageConnectionError(error);
      }
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
