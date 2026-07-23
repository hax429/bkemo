import { observer } from 'mobx-react-lite';
import { CollapsibleCard } from '../../Common/CollapsibleCard';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { PromiseCall } from '@/store/standard/PromiseState';
import { api } from '@/lib/trpc';

export const GlobalPromptSection = observer(() => {
  const { t } = useTranslation();
  const blinko = RootStore.Get(BlinkoStore);
  const [globalPrompt, setGlobalPrompt] = useState('');

  useEffect(() => {
    blinko.config.call();
  }, []);

  useEffect(() => {
    setGlobalPrompt(blinko.config.value?.globalPrompt || '');
  }, [blinko.config.value?.globalPrompt]);

  return (
    <CollapsibleCard icon="hugeicons:message-01" title="Global Prompt" className="bk-ai-card bk-ai-compact-card">
      <div className="v-stack bk-ai-settings-block">
        <label className="bk-native-field">
          <span>{t('global-prompt')}</span>
          <textarea
            value={globalPrompt}
            onChange={(event) => setGlobalPrompt(event.currentTarget.value)}
            onBlur={() => {
              PromiseCall(
                api.config.update.mutate({
                  key: 'globalPrompt',
                  value: globalPrompt,
                }),
                { autoAlert: false },
              );
            }}
            placeholder={`You are a versatile AI assistant who can:
1. Answer questions and explain concepts
2. Provide suggestions and analysis
3. Help with planning and organizing ideas

Always respond in the user's language.
Maintain a friendly and professional conversational tone.`}
            className="bk-native-textarea"
            rows={7}
          />
          <em className="bk-ai-field-help">Applied to global and card AI chats. Saved when you leave the field.</em>
        </label>
      </div>
    </CollapsibleCard>
  );
});
