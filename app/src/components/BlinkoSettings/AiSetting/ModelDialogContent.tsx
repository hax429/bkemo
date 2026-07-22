import { observer } from 'mobx-react-lite';
import { Icon } from '@/components/Common/Iconify/icons';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { RootStore } from '@/store';
import { AiSettingStore, AiModel, ModelCapabilities, ProviderModel } from '@/store/aiSettingStore';
import { DialogStore } from '@/store/module/Dialog';
import { ToastPlugin } from '@/store/module/Toast/Toast';
import { CAPABILITY_ICONS, CAPABILITY_LABELS, DEFAULT_MODEL_TEMPLATES } from './constants';
import { ProviderIcon, ModelIcon } from '@/components/BlinkoSettings/AiSetting/AIIcon';
import { api } from '@/lib/trpc';

const formatTestResults = (result: any, t: (key: string) => string): string => {
  const details: string[] = [];
  if (result?.capabilities?.inference?.success) details.push(`Chat: ${result.capabilities.inference.response || ''}`);
  if (result?.capabilities?.embedding?.success) details.push(`Embedding: ${result.capabilities.embedding.dimensions || 0} dimensions`);
  if (result?.capabilities?.audio?.success) details.push(`Audio: ${result.capabilities.audio.message || ''}`);
  return `${t('check-connect-success')} - ${details.join(', ')}`;
};

interface ModelDialogContentProps {
  model?: AiModel;
}

function initialModel(aiSettingStore: AiSettingStore, model?: AiModel): Partial<AiModel> {
  if (model) return { ...model };
  return {
    id: 0,
    providerId: aiSettingStore.aiProviders.value?.[0]?.id || 0,
    title: '',
    modelKey: '',
    capabilities: {
      inference: true,
      tools: false,
      image: false,
      imageGeneration: false,
      video: false,
      audio: false,
      embedding: false,
      rerank: false,
    },
    config: {
      embeddingDimensions: 0,
    },
    sortOrder: 0,
  };
}

export default observer(function ModelDialogContent({ model }: ModelDialogContentProps) {
  const { t } = useTranslation();
  const aiSettingStore = RootStore.Get(AiSettingStore);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [editingModel, setEditingModel] = useState<Partial<AiModel>>(() => initialModel(aiSettingStore, model));

  const selectedProvider = aiSettingStore.aiProviders.value?.find((provider) => provider.id === editingModel.providerId);

  const getProviderModels = (): ProviderModel[] => {
    if (!selectedProvider) return [];
    return aiSettingStore.getProviderModels(selectedProvider.id);
  };

  const providerModels = getProviderModels();

  const fetchProviderModels = async () => {
    if (!selectedProvider) return;
    try {
      await aiSettingStore.fetchProviderModels.call(selectedProvider as any);
    } catch (error) {
      console.error('Failed to fetch provider models:', error);
    }
  };

  const applyModelKey = (modelKey: string) => {
    const providerModel = providerModels.find((item) => item.id === modelKey);
    const defaultTemplate = DEFAULT_MODEL_TEMPLATES.find((item) => modelKey.toLowerCase().includes(item.modelKey.toLowerCase()));
    const capabilities = defaultTemplate?.capabilities || aiSettingStore.inferModelCapabilities(modelKey);
    const config = defaultTemplate?.config || {};

    setEditingModel((prev) => ({
      ...prev,
      modelKey: providerModel?.id ?? modelKey,
      title: providerModel?.name ?? prev.title ?? defaultTemplate?.title ?? modelKey,
      capabilities: capabilities as ModelCapabilities,
      config: {
        ...prev.config,
        ...config,
      },
    }));
    if (errors.modelKey) setErrors((prev) => ({ ...prev, modelKey: '' }));
  };

  const validateForm = (): boolean => {
    const newErrors: { [key: string]: string } = {};
    if (!editingModel.providerId) newErrors.providerId = 'Please select a provider';
    if (!editingModel.title?.trim()) newErrors.title = 'Model name is required';
    if (!editingModel.modelKey?.trim()) newErrors.modelKey = 'Model key is required';
    if (!editingModel.capabilities || !Object.values(editingModel.capabilities).some(Boolean)) {
      newErrors.capabilities = 'Please select at least one capability';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const testModelConnection = async () => {
    if (!editingModel.modelKey || !selectedProvider || !editingModel.capabilities) return;
    RootStore.Get(ToastPlugin).promise(
      api.ai.testConnect.mutate({
        providerId: selectedProvider.id,
        modelKey: editingModel.modelKey,
        capabilities: editingModel.capabilities,
      }),
      {
        loading: t('loading'),
        success: (result: any) => formatTestResults(result, t),
        error: (error: any) => `${t('check-connect-error')}: ${error.message}`,
      },
    );
  };

  const handleSaveModel = async () => {
    if (!validateForm()) return;
    if (editingModel.id) {
      await aiSettingStore.updateModel.call(editingModel as any);
    } else {
      await aiSettingStore.createModel.call(editingModel as any);
    }
    RootStore.Get(DialogStore).close();
  };

  return (
    <div className="bk-ai-dialog bk-ai-model-dialog">
      <button type="button" className="bk-ai-dialog-close" onClick={() => RootStore.Get(DialogStore).close()} aria-label="Close">
        <Icon icon="hugeicons:cancel-01" width="18" height="18" />
      </button>

      <div className="bk-ai-dialog-hero">
        <div>
          <div className="bk-ai-dialog-kicker">AI model</div>
          <h2>{editingModel.id ? 'Edit model' : 'Add model'}</h2>
          <p>Tell bkemo what this model can do so chat, RAG, voice, and vision use the right tool.</p>
        </div>
        {selectedProvider ? (
          <div className="bk-ai-dialog-mini-provider">
            <ProviderIcon provider={selectedProvider.provider} className="w-5 h-5" />
            <span>{selectedProvider.title}</span>
          </div>
        ) : null}
      </div>

      <div className="bk-ai-dialog-body">
        <div className="bk-ai-form-grid">
          <label className="bk-native-field">
            <span>Provider</span>
            <div className="bk-native-input-wrap">
              <select
                value={editingModel.providerId ? String(editingModel.providerId) : ''}
                onChange={(event) => {
                  setEditingModel((prev) => ({ ...prev, providerId: Number(event.currentTarget.value) }));
                  if (errors.providerId) setErrors((prev) => ({ ...prev, providerId: '' }));
                }}
              >
                {(aiSettingStore.aiProviders.value || []).map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.title}</option>
                ))}
              </select>
            </div>
            {errors.providerId ? <em>{errors.providerId}</em> : null}
          </label>

          <label className="bk-native-field">
            <span>{t('model-name')}</span>
            <div className="bk-native-input-wrap">
              <input
                value={editingModel.title || ''}
                placeholder="Display name"
                onChange={(event) => {
                  setEditingModel((prev) => ({ ...prev, title: event.currentTarget.value }));
                  if (errors.title) setErrors((prev) => ({ ...prev, title: '' }));
                }}
              />
            </div>
            {errors.title ? <em>{errors.title}</em> : null}
          </label>
        </div>

        <div className="bk-ai-model-picker">
          <div className="bk-ai-model-picker-head">
            <div>
              <div className="bk-ai-dialog-kicker">{t('model-selection')}</div>
              <p>Use a provider model list when available, or type the model key manually.</p>
            </div>
            <button
              type="button"
              className="bk-native-button is-secondary is-small"
              onClick={fetchProviderModels}
              disabled={!selectedProvider}
            >
              {aiSettingStore.fetchProviderModels.loading.value ? (
                <Icon icon="line-md:loading-twotone-loop" width="14" height="14" className="animate-spin" />
              ) : (
                <Icon icon="famicons:sync" width="14" height="14" />
              )}
              {t('refresh-model-list')}
            </button>
          </div>

          <label className="bk-native-field">
            <span>Model key</span>
            <div className="bk-native-input-wrap">
              <input
                value={editingModel.modelKey || ''}
                placeholder="gpt-4.1, claude-sonnet-4, text-embedding-3-small..."
                onChange={(event) => applyModelKey(event.currentTarget.value)}
              />
            </div>
            {errors.modelKey ? <em>{errors.modelKey}</em> : null}
          </label>

          {providerModels.length > 0 ? (
            <div className="bk-ai-model-suggestions">
              {providerModels.slice(0, 8).map((item) => (
                <button key={item.id} type="button" onClick={() => applyModelKey(item.id)}>
                  <ModelIcon modelName={item.id} className="w-4 h-4" />
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <section className="bk-ai-capability-panel">
          <div className="bk-ai-model-picker-head">
            <div>
              <div className="bk-ai-dialog-kicker">{t('model-capabilities')}</div>
              <p>{t('model-cap-desc')}</p>
            </div>
            <Icon icon="hugeicons:alert-circle" width="15" height="15" className="bk-ai-muted-icon" />
          </div>

          <div className="bk-ai-capability-grid">
            {Object.entries(CAPABILITY_LABELS).map(([key, label]) => {
              const isSelected = editingModel.capabilities?.[key as keyof ModelCapabilities] || false;
              return (
                <button
                  key={key}
                  type="button"
                  className={isSelected ? 'bk-ai-capability-pill is-selected' : 'bk-ai-capability-pill'}
                  onClick={() => {
                    setEditingModel((prev) => ({
                      ...prev,
                      capabilities: {
                        ...prev.capabilities,
                        [key]: !isSelected,
                      },
                    }));
                    if (errors.capabilities) setErrors((prev) => ({ ...prev, capabilities: '' }));
                  }}
                >
                  {CAPABILITY_ICONS[key as keyof ModelCapabilities]}
                  <span>{label}</span>
                </button>
              );
            })}
          </div>

          {errors.capabilities ? <p className="bk-ai-form-error">{errors.capabilities}</p> : null}

          {editingModel.capabilities?.audio ? (
            <div className="bk-ai-section-warning">
              <Icon icon="hugeicons:alert-circle" width="14" height="14" />
              Currently only OpenAI-compatible audio models are supported.
            </div>
          ) : null}
        </section>

        {editingModel.capabilities?.embedding ? (
          <section className="bk-ai-embedding-dimensions">
            <div className="bk-ai-model-picker-head">
              <div>
                <div className="bk-ai-dialog-kicker">Embedding dimensions</div>
                <p>Leave this as 0 unless the provider needs an explicit vector size.</p>
              </div>
              <span className="bk-ai-help-dot" title="Common values: 384, 512, 768, 1024, 1536, 3072.">?</span>
            </div>
            <label className="bk-native-field">
              <span>Dimensions</span>
              <div className="bk-native-input-wrap">
                <input
                  type="number"
                  value={String(editingModel.config?.embeddingDimensions || 0)}
                  placeholder="0"
                  onChange={(event) => {
                    const dimensions = parseInt(event.currentTarget.value) || 0;
                    setEditingModel((prev) => ({
                      ...prev,
                      config: {
                        ...prev.config,
                        embeddingDimensions: dimensions,
                      },
                    }));
                  }}
                />
              </div>
            </label>
          </section>
        ) : null}
      </div>

      <div className="bk-ai-dialog-footer">
        <button
          type="button"
          className="bk-native-button is-secondary"
          onClick={testModelConnection}
          disabled={!editingModel.modelKey || !selectedProvider}
        >
          <Icon icon="hugeicons:connect" width="16" height="16" />
          {t('test-connection')}
        </button>
        <div className="bk-ai-dialog-footer-actions">
          <button type="button" className="bk-native-button is-ghost" onClick={() => RootStore.Get(DialogStore).close()}>
            Cancel
          </button>
          <button type="button" className="bk-native-button is-primary" onClick={handleSaveModel}>
            {editingModel.id ? t('update') : t('create')}
          </button>
        </div>
      </div>
    </div>
  );
});
