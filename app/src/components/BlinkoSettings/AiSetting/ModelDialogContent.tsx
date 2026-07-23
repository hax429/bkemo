import { observer } from 'mobx-react-lite';
import type { CSSProperties } from 'react';
import { Icon } from '@/components/Common/Iconify/icons';
import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { RootStore } from '@/store';
import { AiSettingStore, AiModel, ModelCapabilities, ProviderModel } from '@/store/aiSettingStore';
import { DialogStore } from '@/store/module/Dialog';
import { CAPABILITY_ICONS, CAPABILITY_LABELS } from './constants';
import { ProviderIcon, ModelIcon } from '@/components/BlinkoSettings/AiSetting/AIIcon';
import { loadPrefs } from '@/lib/bkemoSettings';
import { api } from '@/lib/trpc';
import { resolveModelProfile } from '@shared/lib/modelTemplates';

function dialogThemeAttrs() {
  const prefs = loadPrefs();
  const preset = prefs.theme === 'light'
    ? 'light'
    : (prefs.accent?.toLowerCase() === '#5e6ad2'
      ? 'developer'
      : (prefs.accent?.toLowerCase() === '#e2a96b' ? 'coffee' : 'dusk'));
  const style: CSSProperties = prefs.accent ? { ['--accent' as any]: prefs.accent } : {};
  return { theme: prefs.theme, density: prefs.density, preset, style };
}

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
  const [modelQuery, setModelQuery] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ tone: 'ok' | 'error'; title: string; detail: string } | null>(null);

  const selectedProvider = aiSettingStore.aiProviders.value?.find((provider) => provider.id === editingModel.providerId);

  const getProviderModels = (): ProviderModel[] => {
    if (!selectedProvider) return [];
    return aiSettingStore.getProviderModels(selectedProvider.id);
  };

  const providerModels = getProviderModels();

  const filteredModels = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    if (!q) return providerModels;
    return providerModels.filter((item) => (
      item.id.toLowerCase().includes(q)
      || item.name.toLowerCase().includes(q)
    ));
  }, [modelQuery, providerModels]);

  const fetchProviderModels = async () => {
    if (!selectedProvider) return;
    try {
      await aiSettingStore.fetchProviderModels.call(selectedProvider as any);
    } catch (error) {
      console.error('Failed to fetch provider models:', error);
    }
  };

  const applyModelKey = (modelKey: string, providerModel?: ProviderModel) => {
    const matched = providerModel || providerModels.find((item) => item.id === modelKey);
    const profile = resolveModelProfile(matched?.id || modelKey);
    // Profile heuristics win over stale provider-list defaults.
    const capabilities = profile.capabilities;

    setEditingModel((prev) => ({
      ...prev,
      modelKey: matched?.id ?? modelKey,
      title: matched?.name || profile.title || prev.title || modelKey,
      capabilities,
      config: {
        ...prev.config,
        ...profile.config,
        embeddingDimensions: profile.config.embeddingDimensions
          || Number(prev.config?.embeddingDimensions || 0)
          || 0,
      },
    }));
    setTestResult(null);
    if (errors.modelKey) setErrors((prev) => ({ ...prev, modelKey: '' }));
    if (errors.capabilities) setErrors((prev) => ({ ...prev, capabilities: '' }));
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
    if (!editingModel.modelKey || !selectedProvider || !editingModel.capabilities || testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result: any = await api.ai.testConnect.mutate({
        providerId: selectedProvider.id,
        modelKey: editingModel.modelKey,
        capabilities: editingModel.capabilities,
      });
      const dims = Number(result?.embeddingDimensions || result?.capabilities?.embedding?.dimensions || 0);
      if (dims > 0) {
        setEditingModel((prev) => ({
          ...prev,
          config: {
            ...prev.config,
            embeddingDimensions: dims,
          },
        }));
      }
      const details: string[] = [];
      if (result?.capabilities?.inference?.success) details.push(`Chat ok${result.capabilities.inference.response ? `: ${result.capabilities.inference.response}` : ''}`);
      if (result?.capabilities?.embedding?.success) details.push(`Embedding ok · ${dims || result.capabilities.embedding.dimensions || 0} dims`);
      if (result?.capabilities?.audio?.error) details.push(`Audio: ${result.capabilities.audio.error}`);
      setTestResult({
        tone: 'ok',
        title: 'Connection succeeded',
        detail: details.join(' · ') || 'Provider accepted the model.',
      });
    } catch (error: any) {
      setTestResult({
        tone: 'error',
        title: 'Connection failed',
        detail: error?.message || 'Unknown error',
      });
    } finally {
      setTesting(false);
    }
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

  const theme = dialogThemeAttrs();

  return (
    <div
      className="bkemo bk-ai-dialog bk-ai-model-dialog"
      data-theme={theme.theme}
      data-density={theme.density}
      data-preset={theme.preset}
      style={theme.style}
    >
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
                  setModelQuery('');
                  setTestResult(null);
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
              <p>Pick from the provider list when available, or type the model key manually.</p>
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
            <div className="bk-ai-pick-panel is-inset">
              <label className="bk-ai-search-field">
                <Icon icon="hugeicons:search-01" width="15" height="15" className="bk-ai-search-icon" />
                <input
                  type="search"
                  value={modelQuery}
                  placeholder="Filter models…"
                  onChange={(event) => setModelQuery(event.currentTarget.value)}
                />
              </label>

              <div className="bk-ai-pick-list is-models">
                {filteredModels.length === 0 ? (
                  <div className="bk-ai-pick-empty">No models match “{modelQuery.trim()}”.</div>
                ) : filteredModels.map((item) => {
                  const selected = editingModel.modelKey === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={selected ? 'bk-ai-pick-model-row is-selected' : 'bk-ai-pick-model-row'}
                      onClick={() => applyModelKey(item.id, item)}
                    >
                      <ModelIcon modelName={item.id} className="w-4 h-4" />
                      <span className="bk-ai-pick-model-row-copy">
                        <span className="bk-ai-pick-model-row-title">{item.name}</span>
                        <span className="bk-ai-pick-model-row-key">{item.id}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="bk-ai-pick-empty is-soft">
              Refresh the model list from this provider, or type a model key above.
            </div>
          )}
        </div>

        <section className="bk-ai-capability-panel">
          <div className="bk-ai-model-picker-head">
            <div>
              <div className="bk-ai-dialog-kicker">{t('model-capabilities')}</div>
              <p>Auto-detected from the model id. Adjust if a capability is wrong.</p>
            </div>
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
                    setTestResult(null);
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
                <p>Required for rebuild. Auto-filled from known models or Test connection.</p>
              </div>
              <span className="bk-ai-help-dot" title="Common values: 384, 512, 768, 1024, 1536, 2560, 3072, 4096.">?</span>
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

        {testResult ? (
          <div className={testResult.tone === 'ok' ? 'bk-ai-runtime-notice' : 'bk-ai-runtime-notice is-danger'}>
            <div>{testResult.title}</div>
            <p>{testResult.detail}</p>
          </div>
        ) : null}
      </div>

      <div className="bk-ai-dialog-footer">
        <button
          type="button"
          className="bk-native-button is-secondary"
          onClick={testModelConnection}
          disabled={!editingModel.modelKey || !selectedProvider || testing}
        >
          {testing ? (
            <Icon icon="line-md:loading-twotone-loop" width="16" height="16" className="animate-spin" />
          ) : (
            <Icon icon="hugeicons:connect" width="16" height="16" />
          )}
          {testing ? 'Testing…' : t('test-connection')}
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
