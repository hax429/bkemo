import { observer } from 'mobx-react-lite';
import { Button } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { CollapsibleCard } from '../../Common/CollapsibleCard';
import { useTranslation } from 'react-i18next';
import { useEffect } from 'react';
import { RootStore } from '@/store';
import { DialogStore } from '@/store/module/Dialog';
import { BlinkoStore } from '@/store/blinkoStore';
import ProviderCard from './ProviderCard';
import ProviderDialogContent from './ProviderDialogContent';
import { DefaultModelsSection } from './DefaultModelsSection';
import { GlobalPromptSection } from './GlobalPromptSection';
import { EmbeddingSettingsSection } from './EmbeddingSettingsSection';
import { AiSettingStore } from '@/store/aiSettingStore';
import { AiSetupOverview } from './AiSetupOverview';

// Intentionally hidden for now (kept in repo for later):
// - AiPostProcessingSection
// - McpServersSection / MCP Integration
// - AiToolsSection (Tavily) — will return for global AI chat only

export default observer(function AiSetting() {
  const { t } = useTranslation();
  const aiStore = RootStore.Get(AiSettingStore);
  const blinko = RootStore.Get(BlinkoStore);

  useEffect(() => {
    blinko.config.call();
    aiStore.aiProviders.call();
    aiStore.allModels.call();
  }, []);

  return (
    <div className='bk-ai-settings flex flex-col gap-4'>
      <AiSetupOverview />

      <CollapsibleCard icon="hugeicons:ai-magic" title="AI Providers & Models" className="bk-ai-card">
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <Button
              size='md'
              className='bk-ai-dialog-button is-primary ml-auto'
              startContent={<Icon icon="iconamoon:cloud-add-light" width="20" height="20" />}
              onPress={() => {
                RootStore.Get(DialogStore).setData({
                  isOpen: true,
                  size: '2xl',
                  noPadding: true,
                  onlyContent: true,
                  className: 'bk-ai-modal',
                  content: <ProviderDialogContent />,
                });
              }}
            >
              {t('add-provider')}
            </Button>
          </div>

          {(aiStore.aiProviders.value?.length ?? 0) === 0 ? (
            <div className="bk-ai-empty-state">
              Add a provider first, then create one or more models under it. API keys stay server-side.
            </div>
          ) : aiStore.aiProviders.value?.map(provider => (
            <ProviderCard key={provider.id} provider={provider as any} />
          ))}
        </div>
      </CollapsibleCard>

      <DefaultModelsSection />

      <EmbeddingSettingsSection />

      <GlobalPromptSection />
    </div>
  );
});
