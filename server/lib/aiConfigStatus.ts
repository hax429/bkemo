import { AiModelFactory } from '@server/aiServer/aiModelFactory';
import { prisma } from '../prisma';

function modelHasCapability(model: any, capability: string) {
  return !!(model?.capabilities as any)?.[capability];
}

export async function getAiConfigStatus() {
  const config = await AiModelFactory.globalConfig();
  const [providers, models] = await Promise.all([
    prisma.aiProviders.findMany({ select: { id: true } }),
    prisma.aiModels.findMany({
      select: { id: true, title: true, providerId: true, capabilities: true },
    }),
  ]);
  const mainModel = models.find((model) => model.id === config.mainModelId);
  const embeddingModel = models.find((model) => model.id === config.embeddingModelId);
  const mainModelReady = !!mainModel && modelHasCapability(mainModel, 'inference');
  const embeddingModelReady = !!embeddingModel && modelHasCapability(embeddingModel, 'embedding');

  return {
    providerCount: providers.length,
    modelCount: models.length,
    mainModelId: config.mainModelId ?? null,
    embeddingModelId: config.embeddingModelId ?? null,
    mainModelReady,
    embeddingModelReady,
    // AiModelFactory.GetProvider() currently initializes the main LLM before
    // returning embeddings, so background embedding jobs need both pieces.
    embeddingFeatureReady: mainModelReady && embeddingModelReady,
    mainModelTitle: mainModel?.title ?? null,
    embeddingModelTitle: embeddingModel?.title ?? null,
  };
}
