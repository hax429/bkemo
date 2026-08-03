import { router, authProcedure, requireManageSite } from '../middleware';
import { redactModelWithProvider } from '../lib/aiSecretRedaction';
import { z } from 'zod';
import { AiService } from '@server/aiServer';
import { prisma } from '../prisma';
import { TRPCError } from '@trpc/server';
import { CoreMessage } from '@mastra/core';
import { AiModelFactory } from '@server/aiServer/aiModelFactory';
import { RebuildEmbeddingJob } from '../jobs/rebuildEmbeddingJob';
import { getAllPathTags } from '@server/lib/helper';
import { ModelCapabilities } from '@server/aiServer/types';
import { aiProviders, aiModels } from '@shared/lib/prismaZodType';
import { fetchWithProxy } from '@server/lib/proxy';
import { inferModelCapabilities } from '@shared/lib/modelTemplates';
import { requireOwnedConversation, requireReadableNote } from '@server/lib/noteAccess';
import { getAiConfigStatus } from '@server/lib/aiConfigStatus';
import { requireAiReady, requireEmbeddingModel, requireMainChatModel, streamAIConversation } from '@server/lib/aiConversation';
import { runAIDiscovery } from '@server/lib/aiDiscovery';

export const aiRouter = router({
  configStatus: authProcedure
    .query(async ({ ctx }) => {
      return getAiConfigStatus(Number(ctx.id));
    }),

  embeddingUpsert: authProcedure
    .input(z.object({
      id: z.number(),
      content: z.string(),
      type: z.enum(['update', 'insert'])
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, content, type } = input
      const note = await requireReadableNote(id, Number(ctx.id));
      await requireEmbeddingModel();
      const { ok, error } = await AiService.embeddingUpsert({ id, content, type, createTime: note.createdAt! })
      if (!ok) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error
        })
      }
      return { ok }
    }),

  embeddingInsertAttachments: authProcedure
    .input(z.object({
      id: z.number(),
      filePath: z.string() //api/file/text.pdf
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, filePath } = input
      try {
        const note = await requireReadableNote(id, Number(ctx.id));
        await requireEmbeddingModel();
        const hasAttachment = note.attachments.some((attachment) => attachment.path === filePath || `/api/file/${attachment.path}` === filePath);
        if (!hasAttachment) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Attachment is not readable' });
        }
        const res = await AiService.embeddingInsertAttachments({ id, filePath })
        return res
      } catch (error) {
        return { ok: false, msg: error?.message }
      }
    }),

  embeddingDelete: authProcedure
    .input(z.object({
      id: z.number()
    }))
    .mutation(async ({ input, ctx }) => {
      const { id } = input
      try {
        await requireReadableNote(id, Number(ctx.id));
        await requireEmbeddingModel();
        const res = await AiService.embeddingDelete({ id })
        return res
      } catch (error) {
        return { ok: false, msg: error?.message }
      }
    }),

  completions: authProcedure
    .input(z.object({
      question: z.string(),
      withTools: z.boolean().optional(),
      withOnline: z.boolean().optional(),
      withRAG: z.boolean().optional(),
      conversations: z.array(z.object({ role: z.string(), content: z.string() })),
      systemPrompt: z.string().optional()
    }))
    .mutation(async function* ({ input, ctx }) {
      try {
        const { question, conversations, withTools = false, withOnline = false, withRAG = true, systemPrompt } = input
        await requireAiReady(Number(ctx.id));
        let _conversations = conversations as CoreMessage[]
        const { result: responseStream, notes } = await AiService.completions({
          question,
          conversations: _conversations,
          ctx,
          withTools,
          withOnline,
          withRAG,
          systemPrompt
        })
        yield { notes }
        for await (const chunk of responseStream.fullStream) {
          yield { chunk }
        }
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error?.message
        })
      }
    }),

  chat: authProcedure
    .input(z.object({
      conversationId: z.number().optional(),
      question: z.string().min(1),
      scope: z.enum(['global', 'note', 'analytics']).default('global'),
      noteId: z.number().optional(),
      contextNoteIds: z.array(z.number()).default([]),
      withOnline: z.boolean().optional(),
      withRAG: z.boolean().optional(),
      systemPrompt: z.string().optional(),
      // Client may request loop traces; server only honors this outside production.
      debug: z.boolean().optional(),
    }))
    .mutation(async function* ({ input, ctx }) {
      yield* streamAIConversation(input, ctx);
    }),

  discover: authProcedure
    .input(z.object({
      kind: z.enum(['default', 'value']).default('default'),
      range: z.enum(['3m', '1y', 'all']).default('3m'),
      customPrompt: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return runAIDiscovery({
        accountId: Number(ctx.id),
        ctx,
        kind: input.kind,
        range: input.range,
        customPrompt: input.customPrompt,
      });
    }),

  speechToText: authProcedure
    .input(z.object({
      filePath: z.string()
    }))
    .mutation(async function ({ input }) {
      // const { filePath } = input
      // try {
      //   const localFilePath = await FileService.getFile(filePath)
      //   const doc = await AiService.speechToText(localFilePath)
      //   return doc
      // } catch (error) {
      //   throw new Error(error)
      // }
    }),

  rebuildingEmbeddings: authProcedure
    .input(z.object({
      force: z.boolean().optional()
    }))
    .mutation(async function* ({ input }) {
      const { force } = input
      try {
        await requireEmbeddingModel();
        for await (const result of AiService.rebuildEmbeddingIndex({ force })) {
          yield result;
        }
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error?.message
        })
      }
    }),

  summarizeConversationTitle: authProcedure
    .input(z.object({
      conversations: z.array(z.object({ role: z.string(), content: z.string() })),
      conversationId: z.number()
    }))
    .mutation(async function ({ input, ctx }) {
      const { conversations, conversationId } = input
      await requireOwnedConversation(conversationId, Number(ctx.id));
      const agent = await AiModelFactory.SummarizeAgent()
      const conversationString = JSON.stringify(
        conversations.map(i => ({
          role: i.role,
          content: i.content.slice(0, 500).replace(/\n/g, '\\n')
        })),
        null, 2
      );
      const result = await agent.generate(conversationString, {
        maxTokens: 24,
        temperature: 0.2,
      })
      const title = String(result?.text || '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '')
        .replace(/[。.!！？?]+$/g, '')
        .trim()
        .slice(0, 60);
      const conversation = await prisma.conversation.update({
        where: { id: conversationId },
        data: { title: title || 'New chat' }
      })
      return conversation
    }),

  writing: authProcedure
    .input(z.object({
      question: z.string(),
      type: z.enum(['expand', 'polish', 'custom']).optional(),
      content: z.string().optional()
    }))
    .mutation(async function* ({ input }) {
      const { question, type = 'custom', content } = input
      const agent = await AiModelFactory.WritingAgent(type)
      const result = await agent.stream([
        {
          role: 'user',
          content: question
        },
        {
          role: 'system',
          content: `This is the user's note content: ${content || ''}`
        }
      ]);
      for await (const chunk of result.fullStream) {
        yield chunk
      }
    }),
  autoTag: authProcedure
    .input(z.object({
      content: z.string()
    }))
    .mutation(async function ({ input }) {
      const config = await AiModelFactory.globalConfig();
      const { content } = input
      const tagAgent = await AiModelFactory.TagAgent(config.aiTagsPrompt || undefined);
      const tags = await getAllPathTags();
      const result = await tagAgent.generate(
        `Existing tags list: [${tags.join(', ')}]\nNote content: ${content}\nPlease suggest appropriate tags for this content. Include full hierarchical paths for tags like #Parent/Child instead of just #Child.`
      )
      return result?.text?.trim().split(',').map(tag => tag.trim()).filter(Boolean) ?? []
    }),
  autoEmoji: authProcedure
    .input(z.object({
      content: z.string()
    }))
    .mutation(async function ({ input }) {
      const { content } = input
      const agent = await AiModelFactory.EmojiAgent()
      const result = await agent.generate("Please select and suggest appropriate emojis for the above content" + content)
      console.log(result.text)
      return result?.text?.trim().split(',').map(tag => tag.trim()).filter(Boolean) ?? [];
    }),
  AIComment: authProcedure
    .input(z.object({
      content: z.string(),
      noteId: z.number()
    }))
    .mutation(async function ({ input, ctx }) {
      await requireReadableNote(input.noteId, Number(ctx.id));
      return await AiService.AIComment(input)
    }),

  rebuildEmbeddingStart: authProcedure.use(requireManageSite)
    .input(z.object({
      force: z.boolean().optional(),
      incremental: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      await requireEmbeddingModel();
      await RebuildEmbeddingJob.ForceRebuild(input.force ?? true, input.incremental ?? false);
      return { success: true };
    }),

  rebuildEmbeddingResume: authProcedure.use(requireManageSite)
    .mutation(async () => {
      await requireEmbeddingModel();
      await RebuildEmbeddingJob.ResumeRebuild();
      return { success: true };
    }),

  rebuildEmbeddingRetryFailed: authProcedure.use(requireManageSite)
    .mutation(async () => {
      await requireEmbeddingModel();
      await RebuildEmbeddingJob.RetryFailedNotes();
      return { success: true };
    }),

  rebuildEmbeddingStop: authProcedure.use(requireManageSite)
    .mutation(async () => {
      await RebuildEmbeddingJob.StopRebuild();
      return { success: true };
    }),

  rebuildEmbeddingProgress: authProcedure
    .query(async () => {
      const progress = await RebuildEmbeddingJob.GetProgress();
      return progress || {
        current: 0,
        total: 0,
        percentage: 0,
        isRunning: false,
        results: [],
        lastUpdate: new Date().toISOString()
      };
    }),

  testConnect: authProcedure
    .input(z.object({
      providerId: z.number(),
      modelKey: z.string(),
      capabilities: z.object({
        inference: z.boolean().optional(),
        tools: z.boolean().optional(),
        image: z.boolean().optional(),
        imageGeneration: z.boolean().optional(),
        video: z.boolean().optional(),
        audio: z.boolean().optional(),
        embedding: z.boolean().optional(),
        rerank: z.boolean().optional()
      })
    }))
    .mutation(async ({ input }) => {
      try {
        const { providerId, modelKey, capabilities } = input;

        // Get provider information
        const provider = await prisma.aiProviders.findUnique({
          where: { id: providerId }
        });

        if (!provider) {
          throw new Error('Provider not found');
        }

        // Create temporary model configuration for testing
        const tempModelConfig = {
          provider: provider.provider,
          baseURL: provider.baseURL,
          apiKey: provider.apiKey,
          config: provider.config,
          modelKey,
          capabilities
        };

        // Test based on model capabilities. Prefer embedding/audio-only paths so
        // embedding models are never probed with a chat completion.
        let testResults: any = {};
        const testable = Boolean(capabilities.inference || capabilities.embedding || capabilities.audio);
        if (!testable) {
          throw new Error('Select at least one testable capability (Chat, Embedding, or Audio).');
        }

        if (capabilities.embedding) {
          try {
            const { EmbeddingProvider } = await import('@server/aiServer/providers');
            const embeddingProvider = new EmbeddingProvider();
            const embeddingModel = await embeddingProvider.getEmbeddingModel({
              provider: provider.provider,
              apiKey: provider.apiKey,
              baseURL: provider.baseURL,
              modelKey,
              apiVersion: (provider.config as any)?.apiVersion
            });

            const { embed } = await import('ai');
            const result = await embed({
              model: embeddingModel as any,
              value: 'test embedding'
            });
            testResults.embedding = { success: true, dimensions: result.embedding?.length || 0 };
          } catch (error: any) {
            testResults.embedding = { success: false, error: error?.message || String(error) };
          }
        }

        // Skip chat probing when this model is marked embedding-only.
        if (capabilities.inference && !capabilities.embedding) {
          try {
            const { LLMProvider } = await import('@server/aiServer/providers');
            const llmProvider = new LLMProvider();
            const languageModel = await llmProvider.getLanguageModel({
              provider: provider.provider,
              apiKey: provider.apiKey,
              baseURL: provider.baseURL,
              modelKey,
              apiVersion: (provider.config as any)?.apiVersion
            });

            const { generateText } = await import('ai');
            const result = await generateText({
              model: languageModel,
              prompt: 'Say "Hello" to test connection'
            });
            testResults.inference = { success: true, response: result.text };
          } catch (error: any) {
            testResults.inference = { success: false, error: error?.message || String(error) };
          }
        } else if (capabilities.inference && capabilities.embedding) {
          testResults.inference = {
            success: false,
            error: 'Skipped chat test because embedding is selected. Clear Embedding to test chat.',
          };
        }

        if (capabilities.audio) {
          testResults.audio = {
            success: false,
            error: 'Audio models cannot be tested from this dialog yet.',
          };
        }

        const overallSuccess = Object.values(testResults).some((result: any) => result.success);
        if (!overallSuccess) {
          const details = Object.entries(testResults)
            .map(([key, value]: [string, any]) => `${key}: ${value?.error || 'failed'}`)
            .join('; ');
          throw new Error(details || 'Connection test failed');
        }

        return {
          success: true,
          capabilities: testResults,
          provider: provider.title,
          model: modelKey,
          embeddingDimensions: testResults.embedding?.dimensions || 0,
        };
      } catch (error) {
        console.error("Connection test failed:", error);
        throw new Error(`Connection test failed: ${error?.message || "Unknown error"}`);
      }
    }),

  getAllProviders: authProcedure.use(requireManageSite)
    .query(async () => {
      return await AiModelFactory.getAllAiProviders();
    }),

  createProvider: authProcedure.use(requireManageSite)
    .input(z.object({
      title: z.string(),
      provider: z.string(),
      baseURL: z.string().optional(),
      apiKey: z.string().optional(),
      config: z.any().optional(),
      sortOrder: z.number().default(0)
    }))
    .mutation(async ({ input }) => {
      return await prisma.aiProviders.create({
        data: input,
        include: { models: true }
      });
    }),

  updateProvider: authProcedure.use(requireManageSite)
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      provider: z.string().optional(),
      baseURL: z.string().optional(),
      apiKey: z.string().optional(),
      config: z.any().optional(),
      sortOrder: z.number().optional()
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return await prisma.aiProviders.update({
        where: { id },
        data,
        include: { models: true }
      });
    }),

  deleteProvider: authProcedure.use(requireManageSite)
    .input(z.object({
      id: z.number()
    }))
    .mutation(async ({ input }) => {
      return await prisma.aiProviders.delete({
        where: { id: input.id }
      });
    }),

  getAllModels: authProcedure.use(requireManageSite)
    .query(async () => {
      return await prisma.aiModels.findMany({
        include: { provider: true },
        orderBy: [{ provider: { sortOrder: 'asc' } }, { sortOrder: 'asc' }]
      });
    }),

  getModelsByProvider: authProcedure.use(requireManageSite)
    .input(z.object({
      providerId: z.number()
    }))
    .query(async ({ input }) => {
      return await prisma.aiModels.findMany({
        where: { providerId: input.providerId },
        include: { provider: true },
        orderBy: { sortOrder: 'asc' }
      });
    }),

  getModelsByCapability: authProcedure
    .input(z.object({
      capability: z.string()
    }))
    .query(async ({ input }) => {
      const models = await AiModelFactory.getAiModelsByCapability(input.capability);
      return models.map(redactModelWithProvider);
    }),

  createModel: authProcedure.use(requireManageSite)
    .input(z.object({
      providerId: z.number(),
      title: z.string(),
      modelKey: z.string(),
      capabilities: z.object({
        inference: z.boolean().default(true),
        tools: z.boolean().default(false),
        image: z.boolean().default(false),
        imageGeneration: z.boolean().default(false),
        video: z.boolean().default(false),
        audio: z.boolean().default(false),
        embedding: z.boolean().default(false),
        rerank: z.boolean().default(false)
      }),
      config: z.any().optional(),
      sortOrder: z.number().default(0)
    }))
    .mutation(async ({ input }) => {
      return await prisma.aiModels.create({
        data: input,
        include: { provider: true }
      });
    }),

  updateModel: authProcedure.use(requireManageSite)
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      modelKey: z.string().optional(),
      capabilities: z.object({
        inference: z.boolean().optional(),
        tools: z.boolean().optional(),
        image: z.boolean().optional(),
        imageGeneration: z.boolean().optional(),
        video: z.boolean().optional(),
        audio: z.boolean().optional(),
        embedding: z.boolean().optional(),
        rerank: z.boolean().optional()
      }).optional(),
      config: z.any().optional(),
      sortOrder: z.number().optional()
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return await prisma.aiModels.update({
        where: { id },
        data,
        include: { provider: true }
      });
    }),

  deleteModel: authProcedure.use(requireManageSite)
    .input(z.object({
      id: z.number()
    }))
    .mutation(async ({ input }) => {
      return await prisma.aiModels.delete({
        where: { id: input.id }
      });
    }),


  createModelsFromProvider: authProcedure.use(requireManageSite)
    .input(z.object({
      providerId: z.number(),
      models: z.array(z.object({
        id: z.string(),
        name: z.string(),
        capabilities: z.object({
          inference: z.boolean().default(true),
          tools: z.boolean().default(false),
          image: z.boolean().default(false),
          imageGeneration: z.boolean().default(false),
          video: z.boolean().default(false),
          audio: z.boolean().default(false),
          embedding: z.boolean().default(false),
          rerank: z.boolean().default(false)
        })
      }))
    }))
    .mutation(async ({ input }) => {
      const { providerId, models } = input;

      const createdModels: aiModels[] = [];
      for (const model of models) {
        const created = await prisma.aiModels.create({
          data: {
            providerId,
            title: model.name,
            modelKey: model.id,
            capabilities: model.capabilities,
            sortOrder: 0
          },
          include: { provider: true }
        });
        createdModels.push(created);
      }

      return createdModels;
    }),

  batchCreateModelsFromProvider: authProcedure
    .input(z.object({
      providerId: z.number(),
      selectedModels: z.array(z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional(),
        capabilities: z.object({
          inference: z.boolean().optional(),
          tools: z.boolean().optional(),
          image: z.boolean().optional(),
          imageGeneration: z.boolean().optional(),
          video: z.boolean().optional(),
          audio: z.boolean().optional(),
          embedding: z.boolean().optional(),
          rerank: z.boolean().optional()
        }).optional()
      }))
    }))
    .mutation(async ({ input }) => {
      const { providerId, selectedModels } = input;

      const createdModels: aiModels[] = [];
      for (const model of selectedModels) {
        const created = await prisma.aiModels.create({
          data: {
            providerId,
            title: model.name,
            modelKey: model.id,
            capabilities: model.capabilities || {
              inference: true,
              tools: false,
              image: false,
              imageGeneration: false,
              video: false,
              audio: false,
              embedding: false,
              rerank: false
            },
            sortOrder: 0
          },
          include: { provider: true }
        });
        createdModels.push(created);
      }

      return createdModels;
    }),

  fetchProviderModels: authProcedure
    .input(z.object({
      providerId: z.number()
    }))
    .mutation(async ({ input }) => {
      const { providerId } = input;

      const provider = await prisma.aiProviders.findUnique({
        where: { id: providerId }
      });

      if (!provider) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Provider not found'
        });
      }

      const proxiedFetch = await fetchWithProxy();
      let modelList: any[] = [];

      try {
        switch (provider.provider.toLowerCase()) {
          case 'ollama': {
            const endpoint = provider.baseURL || 'http://127.0.0.1:11434';
            const response = await proxiedFetch(`${endpoint}/api/tags`);
            const data = await response.json() as any;
            modelList = data.models?.map((model: any) => ({
              id: model.name,
              name: model.name,
              description: model.description || '',
              capabilities: inferModelCapabilities(model.name)
            })) || [];
            break;
          }

          case 'openai': {
            const endpoint = provider.baseURL || 'https://api.openai.com/v1';
            const response = await proxiedFetch(`${endpoint}/models`, {
              headers: { 'Authorization': `Bearer ${provider.apiKey}` }
            });
            const data = await response.json() as any;
            modelList = data.data?.map((model: any) => ({
              id: model.id,
              name: model.id,
              description: '',
              capabilities: inferModelCapabilities(model.id)
            })) || [];
            break;
          }

          case 'anthropic': {
            // Static list - Anthropic doesn't provide a list models API
            modelList = [
              { id: 'claude-3-5-sonnet-20241022', name: 'claude-3-5-sonnet-20241022', capabilities: inferModelCapabilities('claude-3-5-sonnet-20241022') },
              { id: 'claude-3-5-sonnet-20240620', name: 'claude-3-5-sonnet-20240620', capabilities: inferModelCapabilities('claude-3-5-sonnet-20240620') },
              { id: 'claude-3-5-haiku-20241022', name: 'claude-3-5-haiku-20241022', capabilities: inferModelCapabilities('claude-3-5-haiku-20241022') },
              { id: 'claude-3-opus-20240229', name: 'claude-3-opus-20240229', capabilities: inferModelCapabilities('claude-3-opus-20240229') },
              { id: 'claude-3-sonnet-20240229', name: 'claude-3-sonnet-20240229', capabilities: inferModelCapabilities('claude-3-sonnet-20240229') },
              { id: 'claude-3-haiku-20240307', name: 'claude-3-haiku-20240307', capabilities: inferModelCapabilities('claude-3-haiku-20240307') }
            ];
            break;
          }

          case 'voyageai': {
            // Static list - VoyageAI doesn't provide a list models API
            modelList = [
              { id: 'voyage-3', name: 'voyage-3', capabilities: inferModelCapabilities('voyage-3') },
              { id: 'voyage-3-lite', name: 'voyage-3-lite', capabilities: inferModelCapabilities('voyage-3-lite') },
              { id: 'voyage-finance-2', name: 'voyage-finance-2', capabilities: inferModelCapabilities('voyage-finance-2') },
              { id: 'voyage-multilingual-2', name: 'voyage-multilingual-2', capabilities: inferModelCapabilities('voyage-multilingual-2') },
              { id: 'voyage-law-2', name: 'voyage-law-2', capabilities: inferModelCapabilities('voyage-law-2') },
              { id: 'voyage-code-2', name: 'voyage-code-2', capabilities: inferModelCapabilities('voyage-code-2') },
              { id: 'voyage-large-2-instruct', name: 'voyage-large-2-instruct', capabilities: inferModelCapabilities('voyage-large-2-instruct') },
              { id: 'voyage-large-2', name: 'voyage-large-2', capabilities: inferModelCapabilities('voyage-large-2') }
            ];
            break;
          }

          case 'google': {
            const endpoint = provider.baseURL || 'https://generativelanguage.googleapis.com/v1beta';
            const response = await proxiedFetch(`${endpoint}/models?key=${provider.apiKey}`);
            const data = await response.json() as any;
            modelList = data.models?.map((model: any) => ({
              id: model.name.replace('models/', ''),
              name: model.displayName || model.name.replace('models/', ''),
              description: model.description || '',
              capabilities: inferModelCapabilities(model.name)
            })) || [];
            break;
          }

          case 'azure': {
            const endpoint = provider.baseURL;
            const response = await proxiedFetch(`${endpoint}/openai/models?api-version=2024-02-01`, {
              headers: { 'api-key': provider.apiKey || '' }
            });
            const data = await response.json() as any;
            modelList = data.data?.map((model: any) => ({
              id: model.id,
              name: model.id,
              description: '',
              capabilities: inferModelCapabilities(model.id)
            })) || [];
            break;
          }

          case 'minimax': {
            // Static list - MiniMax models with known capabilities
            modelList = [
              { id: 'MiniMax-M2.7', name: 'MiniMax M2.7', capabilities: inferModelCapabilities('MiniMax-M2.7') },
              { id: 'MiniMax-M2.5', name: 'MiniMax M2.5', capabilities: inferModelCapabilities('MiniMax-M2.5') },
              { id: 'MiniMax-M2.5-highspeed', name: 'MiniMax M2.5 Highspeed', capabilities: inferModelCapabilities('MiniMax-M2.5-highspeed') }
            ];
            break;
          }

          default: {
            // Default: use OpenAI-compatible API format
            const endpoint = provider.baseURL;
            if (!endpoint) {
              throw new Error('Base URL is required for custom providers');
            }
            const response = await proxiedFetch(`${endpoint}/models`, {
              headers: { 'Authorization': `Bearer ${provider.apiKey}` }
            });
            const data = await response.json() as any;
            modelList = data.data?.map((model: any) => ({
              id: model.id,
              name: model.id,
              description: '',
              capabilities: inferModelCapabilities(model.id)
            })) || [];
            break;
          }
        }

        // Update provider config with fetched models
        await prisma.aiProviders.update({
          where: { id: providerId },
          data: {
            config: {
              ...(provider.config as any || {}),
              models: modelList
            }
          }
        });

        return modelList;
      } catch (error: any) {
        console.error('Error fetching provider models:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch models: ${error?.message || 'Unknown error'}`
        });
      }
    }),
})
