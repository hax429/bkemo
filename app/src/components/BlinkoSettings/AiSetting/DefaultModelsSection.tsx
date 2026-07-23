import { observer } from 'mobx-react-lite';
import { CollapsibleCard } from '../../Common/CollapsibleCard';
import { useTranslation } from 'react-i18next';
import { useEffect } from 'react';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { PromiseCall } from '@/store/standard/PromiseState';
import { api } from '@/lib/trpc';
import { AiSettingStore, type AiModel } from '@/store/aiSettingStore';
import { resolveModelProfile } from '@shared/lib/modelTemplates';

function modelLabel(model: AiModel) {
  const provider = model.provider?.title || model.provider?.provider || 'provider';
  return `${model.title || model.modelKey} · ${provider}`;
}

function ModelField({
  label,
  help,
  warning,
  value,
  models,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  help?: string;
  warning?: string;
  value?: number | null;
  models: AiModel[];
  placeholder: string;
  disabled?: boolean;
  onChange: (id: number) => void;
}) {
  return (
    <label className="bk-native-field">
      <span>{label}</span>
      <div className="bk-native-input-wrap">
        <select
          value={value ? String(value) : ''}
          disabled={disabled || models.length === 0}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (next) onChange(next);
          }}
        >
          <option value="">{models.length === 0 ? 'No models available' : placeholder}</option>
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {modelLabel(model)}
            </option>
          ))}
        </select>
      </div>
      {warning ? <em className="bk-ai-field-warning">{warning}</em> : null}
      {!warning && help ? <em className="bk-ai-field-help">{help}</em> : null}
    </label>
  );
}

export const DefaultModelsSection = observer(() => {
  const { t } = useTranslation();
  const aiSettingStore = RootStore.Get(AiSettingStore);
  const blinko = RootStore.Get(BlinkoStore);
  const hasLoadedModels = !!aiSettingStore.allModels.value;
  const selectedMainMissing = hasLoadedModels && !!blinko.config.value?.mainModelId && !aiSettingStore.inferenceModels.some((model) => model.id === blinko.config.value?.mainModelId);
  const selectedEmbeddingMissing = hasLoadedModels && !!blinko.config.value?.embeddingModelId && !aiSettingStore.embeddingModels.some((model) => model.id === blinko.config.value?.embeddingModelId);
  const selectedVoiceMissing = hasLoadedModels && !!blinko.config.value?.voiceModelId && !aiSettingStore.voiceModels.some((model) => model.id === blinko.config.value?.voiceModelId);
  const selectedImageMissing = hasLoadedModels && !!blinko.config.value?.imageModelId && !aiSettingStore.imageModels.some((model) => model.id === blinko.config.value?.imageModelId);

  useEffect(() => {
    blinko.config.call();
    aiSettingStore.aiProviders.call();
    aiSettingStore.allModels.call();
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) aiSettingStore.allModels.call();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const updateConfig = (key: string, value: number) => {
    PromiseCall(api.config.update.mutate({ key, value }), { autoAlert: false }).then(() => {
      blinko.config.call();
    });
  };

  return (
    <CollapsibleCard icon="hugeicons:settings-02" title="Default Models" className="bk-ai-card">
      <div className="v-stack bk-ai-settings-block">
        <div className="bk-ai-section-note">
          Main chat and embedding are both required. Without an embedding model, global AI, card AI, and discovery stay blocked.
        </div>

        <div className="bk-ai-form-grid">
          <ModelField
            label="Main chat model"
            placeholder={t('select') || 'Select model'}
            value={blinko.config.value?.mainModelId}
            models={aiSettingStore.inferenceModels}
            warning={selectedMainMissing ? 'The saved main model is missing or not inference-capable.' : undefined}
            help={aiSettingStore.inferenceModels.length === 0 ? 'Create an inference-capable model first.' : undefined}
            onChange={(id) => updateConfig('mainModelId', id)}
          />

          <ModelField
            label="Embedding model"
            placeholder="Select embedding model"
            value={blinko.config.value?.embeddingModelId}
            models={aiSettingStore.embeddingModels}
            warning={selectedEmbeddingMissing ? 'The saved embedding model is missing or not embedding-capable.' : undefined}
            help={aiSettingStore.embeddingModels.length === 0 ? 'Add an embedding-capable model to enable RAG and rebuilds.' : undefined}
            onChange={(id) => {
              const selected = aiSettingStore.embeddingModels.find((model) => model.id === id);
              const inferredDims = selected ? resolveModelProfile(selected.modelKey).config.embeddingDimensions : undefined;
              const currentDims = Number((selected?.config as any)?.embeddingDimensions || 0);
              PromiseCall(api.config.update.mutate({
                key: 'embeddingModelId',
                value: id,
              }), { autoAlert: false }).then(async () => {
                if (selected && inferredDims && !currentDims) {
                  await aiSettingStore.updateModel.call({
                    id: selected.id,
                    config: {
                      ...(selected.config as any || {}),
                      embeddingDimensions: inferredDims,
                    },
                  } as any);
                }
                blinko.config.call();
                aiSettingStore.allModels.call();
              });
            }}
          />

          <ModelField
            label="Voice model"
            placeholder="Select voice model"
            value={blinko.config.value?.voiceModelId}
            models={aiSettingStore.voiceModels}
            disabled={aiSettingStore.voiceModels.length === 0}
            warning={selectedVoiceMissing ? 'The saved voice model is missing or not audio-capable.' : undefined}
            onChange={(id) => updateConfig('voiceModelId', id)}
          />

          <ModelField
            label="Vision model"
            placeholder="Select vision model"
            value={blinko.config.value?.imageModelId}
            models={aiSettingStore.imageModels}
            disabled={aiSettingStore.imageModels.length === 0}
            warning={selectedImageMissing ? 'The saved vision model is missing or not image-capable.' : undefined}
            onChange={(id) => updateConfig('imageModelId', id)}
          />
        </div>
      </div>
    </CollapsibleCard>
  );
});
