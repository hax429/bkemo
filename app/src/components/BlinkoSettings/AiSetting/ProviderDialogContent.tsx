import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import { Icon } from '@/components/Common/Iconify/icons';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { RootStore } from '@/store';
import { DialogStore } from '@/store/module/Dialog';
import { ProviderIcon } from '@/components/BlinkoSettings/AiSetting/AIIcon';
import { AiProvider, AiSettingStore } from '@/store/aiSettingStore';
import { PROVIDER_TEMPLATES } from './constants';

interface ProviderDialogContentProps {
  provider?: AiProvider;
}

function StepsIndicator({ currentStep, totalSteps }: { currentStep: number; totalSteps: number }) {
  return (
    <div className="bk-ai-dialog-steps">
      {Array.from({ length: totalSteps }, (_, index) => {
        const active = index + 1 <= currentStep;
        return (
          <div key={index} className="bk-ai-dialog-step-wrap">
            <div className={active ? 'bk-ai-dialog-step is-active' : 'bk-ai-dialog-step'}>{index + 1}</div>
            {index < totalSteps - 1 ? (
              <div className={index + 1 < currentStep ? 'bk-ai-dialog-step-line is-active' : 'bk-ai-dialog-step-line'} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function NativeField({
  label,
  value,
  placeholder,
  type = 'text',
  onChange,
  endContent,
}: {
  label: string;
  value: string;
  placeholder?: string;
  type?: string;
  onChange: (value: string) => void;
  endContent?: ReactNode;
}) {
  return (
    <label className="bk-native-field">
      <span>{label}</span>
      <div className="bk-native-input-wrap">
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        {endContent ? <div className="bk-native-field-end">{endContent}</div> : null}
      </div>
    </label>
  );
}

export default observer(function ProviderDialogContent({ provider }: ProviderDialogContentProps) {
  const { t } = useTranslation();
  const aiSettingStore = RootStore.Get(AiSettingStore);
  const [currentStep, setCurrentStep] = useState(provider ? 2 : 1);
  const [selectedTemplate, setSelectedTemplate] = useState<string>(provider?.provider || '');

  const [editingProvider, setEditingProvider] = useState<Partial<AiProvider>>(() => {
    if (provider) return { ...provider };
    return {
      id: 0,
      title: '',
      provider: '',
      baseURL: '',
      apiKey: '',
      sortOrder: 0,
      models: [],
    };
  });

  useEffect(() => {
    if (provider) {
      setCurrentStep(2);
      setSelectedTemplate(provider.provider);
    }
  }, [provider]);

  const handleTemplateSelect = (templateValue: string) => {
    if (templateValue === 'custom') {
      setSelectedTemplate('custom');
      setEditingProvider((prev) => ({
        ...prev,
        provider: 'custom',
        title: 'Custom Provider',
        baseURL: 'https://api.example.com/v1',
      }));
    } else {
      const template = PROVIDER_TEMPLATES.find((item) => item.value === templateValue);
      if (template) {
        setSelectedTemplate(templateValue);
        setEditingProvider((prev) => ({
          ...prev,
          provider: template.value,
          title: template.defaultName,
          baseURL: template.defaultBaseURL,
        }));
      }
    }
    setCurrentStep(2);
  };

  const handleSaveProvider = async () => {
    if (!editingProvider) return;
    if (editingProvider.id) {
      await aiSettingStore.updateProvider.call(editingProvider as any);
    } else {
      await aiSettingStore.createProvider.call(editingProvider as any);
    }
    RootStore.Get(DialogStore).close();
  };

  const selectedProviderLabel = selectedTemplate === 'custom'
    ? t('custom-configuration')
    : PROVIDER_TEMPLATES.find((item) => item.value === selectedTemplate)?.label;

  const copyKey = () => {
    if (editingProvider.apiKey) navigator.clipboard?.writeText(editingProvider.apiKey);
  };

  const renderProviderSelection = () => (
    <div className="bk-ai-template-grid is-compact">
      <button type="button" className="bk-ai-template-card is-wide" onClick={() => handleTemplateSelect('custom')}>
        <span className="bk-ai-provider-badge">
          <ProviderIcon provider="openai" className="w-6 h-6" />
          <span className="bk-ai-provider-badge-mark">
            <Icon icon="hugeicons:settings-03" width="10" height="10" />
          </span>
        </span>
        <span className="bk-ai-template-copy">
          <span className="bk-ai-template-title">Custom provider</span>
          <span className="bk-ai-template-desc">OpenAI-compatible endpoint, local gateway, or proxy.</span>
        </span>
        <Icon icon="hugeicons:arrow-right-02" width="17" height="17" className="bk-ai-template-arrow" />
      </button>

      {PROVIDER_TEMPLATES.map((template) => (
        <button key={template.value} type="button" className="bk-ai-template-card" onClick={() => handleTemplateSelect(template.value)}>
          <ProviderIcon provider={template.value} className="w-7 h-7" />
          <span className="bk-ai-template-copy">
            <span className="bk-ai-template-title">{template.label}</span>
            <span className="bk-ai-template-desc">{template.description}</span>
          </span>
          <Icon icon="hugeicons:arrow-right-02" width="15" height="15" className="bk-ai-template-arrow" />
        </button>
      ))}
    </div>
  );

  const renderConfiguration = () => (
    <div className="bk-ai-form-stack">
      <div className="bk-ai-dialog-provider-head">
        <span className="bk-ai-provider-badge is-large">
          <ProviderIcon provider={selectedTemplate || 'openai'} className="w-8 h-8" />
        </span>
        <div>
          <div className="bk-ai-dialog-kicker">provider endpoint</div>
          <h3>{selectedProviderLabel}</h3>
        </div>
      </div>

      <NativeField
        label={t('provider-name')}
        placeholder={t('enter-provider-name')}
        value={editingProvider.title || ''}
        onChange={(value) => setEditingProvider((prev) => ({ ...prev, title: value }))}
      />
      <NativeField
        label={t('base-url')}
        placeholder={t('enter-api-base-url')}
        value={editingProvider.baseURL || ''}
        onChange={(value) => setEditingProvider((prev) => ({ ...prev, baseURL: value }))}
      />
      <NativeField
        label={t('api-key')}
        placeholder={t('enter-api-key')}
        type="password"
        value={editingProvider.apiKey || ''}
        onChange={(value) => setEditingProvider((prev) => ({ ...prev, apiKey: value }))}
        endContent={(
          <button type="button" className="bk-native-mini-button" onClick={copyKey}>
            copy
          </button>
        )}
      />

      {(editingProvider.provider === 'azure' || editingProvider.provider === 'azureopenai') ? (
        <NativeField
          label={t('api-version')}
          placeholder="2024-02-01"
          value={editingProvider.config?.apiVersion || ''}
          onChange={(value) => {
            setEditingProvider((prev) => ({
              ...prev,
              config: {
                ...prev.config,
                apiVersion: value,
              },
            }));
          }}
        />
      ) : null}
    </div>
  );

  return (
    <div className="bk-ai-dialog">
      <button type="button" className="bk-ai-dialog-close" onClick={() => RootStore.Get(DialogStore).close()} aria-label="Close">
        <Icon icon="hugeicons:cancel-01" width="18" height="18" />
      </button>
      <div className="bk-ai-dialog-hero">
        <div>
          <div className="bk-ai-dialog-kicker">AI provider</div>
          <h2>{provider ? 'Edit provider' : 'Connect provider'}</h2>
          <p>Pick an API source, then keep its key and endpoint stored in bkemo settings.</p>
        </div>
        <StepsIndicator currentStep={currentStep} totalSteps={2} />
      </div>

      <div className="bk-ai-dialog-body">
        {currentStep === 1 ? renderProviderSelection() : renderConfiguration()}
      </div>

      <div className="bk-ai-dialog-footer">
        {currentStep > 1 ? (
          <button type="button" className="bk-native-button is-secondary" onClick={() => setCurrentStep(currentStep - 1)}>
            <Icon icon="hugeicons:arrow-left-02" width="16" height="16" />
            {t('back')}
          </button>
        ) : <span />}

        {currentStep === 2 ? (
          <button type="button" className="bk-native-button is-primary" onClick={handleSaveProvider}>
            {editingProvider.id ? t('update') : t('create')}
          </button>
        ) : null}
      </div>
    </div>
  );
});
