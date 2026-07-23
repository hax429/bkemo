import { AiModelFactory } from '@server/aiServer/aiModelFactory';
import { prisma } from '../prisma';

function modelHasCapability(model: any, capability: string) {
  return !!(model?.capabilities as any)?.[capability];
}

export async function getAiConfigStatus(accountId?: number) {
  const config = await AiModelFactory.globalConfig();
  const [providers, models, noteCount] = await Promise.all([
    prisma.aiProviders.findMany({ select: { id: true } }),
    prisma.aiModels.findMany({
      select: { id: true, title: true, providerId: true, capabilities: true },
    }),
    accountId
      ? prisma.notes.count({ where: { accountId, isRecycle: false } })
      : Promise.resolve(0),
  ]);
  const mainModel = models.find((model) => model.id === config.mainModelId);
  const embeddingModel = models.find((model) => model.id === config.embeddingModelId);
  const mainModelReady = !!mainModel && modelHasCapability(mainModel, 'inference');
  const embeddingModelReady = !!embeddingModel && modelHasCapability(embeddingModel, 'embedding');
  const embeddingIndexReady = embeddingModelReady && (
    !accountId ||
    noteCount === 0 ||
    await AiModelFactory.hasIndexedVectors(accountId)
  );

  return {
    providerCount: providers.length,
    modelCount: models.length,
    mainModelId: config.mainModelId ?? null,
    embeddingModelId: config.embeddingModelId ?? null,
    mainModelReady,
    embeddingModelReady,
    embeddingIndexReady,
    // AiModelFactory.GetProvider() currently initializes the main LLM before
    // returning embeddings, so background embedding jobs need both pieces.
    embeddingFeatureReady: mainModelReady && embeddingModelReady,
    mainModelTitle: mainModel?.title ?? null,
    embeddingModelTitle: embeddingModel?.title ?? null,
  };
}
