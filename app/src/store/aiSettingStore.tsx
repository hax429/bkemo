import { makeAutoObservable } from 'mobx';
import { Store } from './standard/base';
import { PromiseCall, PromiseState } from './standard/PromiseState';
import { api } from '@/lib/trpc';
import { aiProviders, aiModels, mcpServers } from '@shared/lib/prismaZodType';
import { RootStore } from './root';
import { ToastPlugin } from './module/Toast/Toast';
import i18n from '@/lib/i18n';
import { defaultUrlTransform } from 'react-markdown';
import { resolveModelProfile as resolveSharedModelProfile } from '@shared/lib/modelTemplates';

export type McpServer = mcpServers;

export interface ModelCapabilities {
    inference: boolean;
    tools: boolean;
    image: boolean;
    imageGeneration: boolean;
    video: boolean;
    audio: boolean;
    embedding: boolean;
    rerank: boolean;
}

export interface ProviderModel {
    id: string;
    name: string;
    description?: string;
    capabilities: ModelCapabilities;
}

export type AiProvider = aiProviders & { models?: AiModel[] };
export type AiModel = aiModels & { provider?: AiProvider; capabilities: ModelCapabilities };

export class AiSettingStore implements Store {
    sid = 'AiSettingStore'
    constructor() {
        makeAutoObservable(this);
    }

    // Provider management
    aiProviders = new PromiseState({
        function: async () => {
            const res = await api.ai.getAllProviders.query();
            return res;
        },
    });

    // Model management
    allModels = new PromiseState({
        function: async () => {
            const res = await api.ai.getAllModels.query();
            return res.map(model => ({
                ...model,
                capabilities: model.capabilities as any
            }));
        },
    });

    // Provider CRUD operations
    createProvider = new PromiseState({
        function: async (data: { title: string; provider: string; baseURL?: string; apiKey?: string; config?: any; sortOrder: number }) => {
            await PromiseCall(api.ai.createProvider.mutate(data));
            await this.aiProviders.call();
        },
    });

    updateProvider = new PromiseState({
        function: async (data: { id: number; title?: string; provider?: string; baseURL?: string; apiKey?: string; config?: any; sortOrder?: number }) => {
            await PromiseCall(api.ai.updateProvider.mutate(data));
            await this.aiProviders.call();
        },
    });

    deleteProvider = new PromiseState({
        function: async (id: number) => {
            await PromiseCall(api.ai.deleteProvider.mutate({ id }));
            await this.aiProviders.call();
        },
    });

    // Model CRUD operations
    createModel = new PromiseState({
        function: async (data: { title: string; modelKey: string; providerId: number; capabilities: ModelCapabilities; config?: any; sortOrder: number }) => {
            await PromiseCall(api.ai.createModel.mutate(data));
            await this.aiProviders.call();
            await this.allModels.call();
        },
    });

    updateModel = new PromiseState({
        function: async (data: { id: number; title?: string; modelKey?: string; capabilities?: ModelCapabilities; config?: any; sortOrder?: number }) => {
            await PromiseCall(api.ai.updateModel.mutate(data));
            await this.aiProviders.call();
            await this.allModels.call();
        },
    });

    deleteModel = new PromiseState({
        function: async (data: { id: number }) => {
            await PromiseCall(api.ai.deleteModel.mutate({ id: data.id }));
            await this.aiProviders.call();
            await this.allModels.call();
        },
    });

    createModelsFromProvider = new PromiseState({
        function: async (data: { providerId: number; models: { modelKey: string; title: string; capabilities: ModelCapabilities; config?: any }[] }) => {
            await PromiseCall(api.ai.createModelsFromProvider.mutate(data as any));
            await this.aiProviders.call();
            await this.allModels.call();
        },
    });

    // Provider model fetching - now calls backend API for Docker network compatibility
    fetchProviderModels = new PromiseState({
        successMsg: i18n.t('model-list-updated'),
        function: async (provider: AiProvider) => {
            try {
                // Call backend API to fetch models (enables Docker internal network access)
                const modelList = await api.ai.fetchProviderModels.mutate({
                    providerId: provider.id
                });

                // Reload providers to get updated config
                await this.aiProviders.call();

                return modelList;
            } catch (error) {
                console.error('Error fetching provider models:', error);
                throw error;
            }
        },
    });

    getProviderModels = (providerId: number): ProviderModel[] => {
        // Get models from provider config stored in database
        const provider = this.aiProviders.value?.find(p => p.id === providerId);
        const configModels = (provider?.config as any)?.models;
        if (configModels && Array.isArray(configModels)) {
            return configModels;
        }

        return [];
    };

    inferModelCapabilities = (modelName: string): ModelCapabilities => {
        return resolveSharedModelProfile(modelName).capabilities;
    };

    resolveModelProfile = (modelName: string) => resolveSharedModelProfile(modelName);

    // Getter methods for different model types
    get inferenceModels(): AiModel[] {
        return this.allModels.value?.filter(model => model.capabilities.inference) || [];
    }

    get embeddingModels(): AiModel[] {
        return this.allModels.value?.filter(model => model.capabilities.embedding) || [];
    }

    get audioModels(): AiModel[] {
        return this.allModels.value?.filter(model => model.capabilities.audio) || [];
    }

    get imageModels(): AiModel[] {
        return this.allModels.value?.filter(model => model.capabilities.image) || [];
    }

    get imageGenerationModels(): AiModel[] {
        return this.allModels.value?.filter(model => model.capabilities.imageGeneration) || [];
    }

    get voiceModels(): AiModel[] {
        return this.allModels.value?.filter(model => model.capabilities.audio) || [];
    }

    get rerankModels(): AiModel[] {
        return this.allModels.value?.filter(model => model.capabilities.rerank) || [];
    }

    // MCP Server management
    mcpServers = new PromiseState({
        function: async () => {
            const res = await api.mcpServers.list.query();
            return res;
        },
    });

    mcpConnectionStatus = new PromiseState({
        function: async () => {
            const res = await api.mcpServers.connectionStatus.query();
            return res;
        },
    });

    createMcpServer = new PromiseState({
        function: async (data: {
            name: string;
            description?: string;
            type: 'stdio' | 'sse' | 'streamable-http';
            command?: string;
            args?: string[];
            url?: string;
            env?: Record<string, string>;
            headers?: Record<string, string>;
            isEnabled?: boolean;
        }) => {
            await PromiseCall(api.mcpServers.create.mutate(data));
            await this.mcpServers.call();
        },
    });

    updateMcpServer = new PromiseState({
        function: async (data: {
            id: number;
            name?: string;
            description?: string;
            type?: 'stdio' | 'sse' | 'streamable-http';
            command?: string;
            args?: string[];
            url?: string;
            env?: Record<string, string>;
            headers?: Record<string, string>;
            isEnabled?: boolean;
        }) => {
            await PromiseCall(api.mcpServers.update.mutate(data));
            await this.mcpServers.call();
        },
    });

    deleteMcpServer = new PromiseState({
        function: async (id: number) => {
            await PromiseCall(api.mcpServers.delete.mutate({ id }));
            await this.mcpServers.call();
        },
    });

    toggleMcpServer = new PromiseState({
        function: async (id: number, enabled: boolean) => {
            await PromiseCall(api.mcpServers.toggle.mutate({ id, enabled }));
            await this.mcpServers.call();
        },
    });

    testMcpConnection = new PromiseState({
        function: async (id: number) => {
            const res = await PromiseCall(api.mcpServers.testConnection.mutate({ id }));
            await this.mcpConnectionStatus.call();
            return res;
        },
    });

    disconnectMcpServer = new PromiseState({
        function: async (id: number) => {
            await PromiseCall(api.mcpServers.disconnect.mutate({ id }));
            await this.mcpConnectionStatus.call();
        },
    });
}