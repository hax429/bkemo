import { observer } from 'mobx-react-lite';
import { Button } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { RootStore } from '@/store';
import { DialogStore } from '@/store/module/Dialog';
import { BlinkoStore } from '@/store/blinkoStore';
import { AiSettingStore } from '@/store/aiSettingStore';
import ProviderDialogContent from './ProviderDialogContent';
import ModelDialogContent from './ModelDialogContent';

function statusTone(ok: boolean, optional = false) {
  if (ok) return { label: 'Ready', color: '#45b878' };
  if (optional) return { label: 'Optional', color: 'var(--fg-3)' };
  return { label: 'Needed', color: 'var(--urgent)' };
}

function SetupItem({
  title,
  detail,
  ok,
  optional,
}: {
  title: string;
  detail: string;
  ok: boolean;
  optional?: boolean;
}) {
  const tone = statusTone(ok, optional);
  return (
    <div className="bk-ai-setup-item">
      <div className="h-stack" style={{ gap: 8 }}>
        <span className="bk-ai-setup-dot" style={{ background: tone.color }} />
        <span className="bk-ai-setup-title">{title}</span>
        <span className="spacer" />
        <span className="bk-ai-setup-status" style={{ color: tone.color }}>{tone.label}</span>
      </div>
      <div className="bk-ai-setup-detail">{detail}</div>
    </div>
  );
}

export const AiSetupOverview = observer(function AiSetupOverview() {
  const blinko = RootStore.Get(BlinkoStore);
  const aiStore = RootStore.Get(AiSettingStore);
  const providers = aiStore.aiProviders.value ?? [];
  const models = aiStore.allModels.value ?? [];
  const mainModel = aiStore.inferenceModels.find((model) => model.id === blinko.config.value?.mainModelId);
  const embeddingModel = aiStore.embeddingModels.find((model) => model.id === blinko.config.value?.embeddingModelId);
  const hasProvider = providers.length > 0;
  const hasInferenceModel = aiStore.inferenceModels.length > 0;

  const openProviderDialog = () => {
    RootStore.Get(DialogStore).setData({
      isOpen: true,
      size: '2xl',
      noPadding: true,
      onlyContent: true,
      className: 'bk-ai-modal',
      content: <ProviderDialogContent />,
    });
  };

  const openModelDialog = () => {
    const provider = providers[0];
    if (!provider) return openProviderDialog();
    RootStore.Get(DialogStore).setData({
      isOpen: true,
      size: '2xl',
      noPadding: true,
      onlyContent: true,
      className: 'bk-ai-modal',
      content: <ModelDialogContent model={{
        id: 0,
        providerId: provider.id,
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
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any} />,
    });
  };

  return (
    <section className="bk-ai-setup-panel">
      <div className="h-stack bk-ai-setup-head">
        <div>
          <div className="bk-ai-setup-kicker">AI configuration</div>
          <h2>Make AI usable before tuning it.</h2>
          <p>Main chat is required for `/ai`. Embeddings unlock note search, card context, and discovery.</p>
        </div>
        <div className="h-stack bk-ai-setup-actions">
          <Button size="sm" variant="flat" className="bk-ai-dialog-button is-secondary" onPress={() => aiStore.aiProviders.call().then(() => aiStore.allModels.call())}>
            Refresh
          </Button>
          <Button size="sm" className="bk-ai-dialog-button is-primary" startContent={<Icon icon="hugeicons:ai-magic" width="16" height="16" />} onPress={hasProvider ? openModelDialog : openProviderDialog}>
            {hasProvider ? 'Add Model' : 'Add Provider'}
          </Button>
        </div>
      </div>

      <div className="bk-ai-setup-grid">
        <SetupItem
          title="Provider"
          ok={hasProvider}
          detail={hasProvider ? `${providers.length} provider${providers.length === 1 ? '' : 's'} configured.` : 'Add OpenAI, Anthropic, Google, Ollama, or a custom endpoint.'}
        />
        <SetupItem
          title="Main chat model"
          ok={!!mainModel}
          detail={mainModel ? `${mainModel.title} via ${mainModel.provider?.title ?? 'provider'}.` : hasInferenceModel ? 'Choose one inference-capable model below.' : 'Create a model with the inference capability.'}
        />
        <SetupItem
          title="Embedding model"
          ok={!!embeddingModel}
          detail={embeddingModel ? `${embeddingModel.title} powers note retrieval.` : 'Without this, chat still works but cannot search your notes.'}
        />
        <SetupItem
          title="Optional models"
          ok={models.some((model) => model.capabilities.audio || model.capabilities.image)}
          optional
          detail="Voice and vision are used only by features that explicitly need them."
        />
      </div>
    </section>
  );
});
