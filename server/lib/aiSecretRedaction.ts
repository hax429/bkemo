/** Strip provider secrets from AI provider/model payloads returned to clients. */
export function redactProviderSecrets<T extends { apiKey?: string | null }>(provider: T): T {
  if (!provider) return provider;
  return {
    ...provider,
    apiKey: provider.apiKey ? '********' : provider.apiKey,
  };
}

export function redactModelWithProvider<T extends { provider?: { apiKey?: string | null } | null }>(model: T): T {
  if (!model?.provider) return model;
  return {
    ...model,
    provider: redactProviderSecrets(model.provider),
  };
}
