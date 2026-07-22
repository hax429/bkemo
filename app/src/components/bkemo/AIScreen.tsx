import { observer } from 'mobx-react-lite';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import type { Note } from '@shared/lib/types';
import { AIGlobalChat, type AIMessage } from './ai/AIThread';

export const AIScreen = observer(function AIScreen({ onOpen }: { onOpen: (note: Note) => void }) {
  const blinko = RootStore.Get(BlinkoStore);

  const saveAssistantResponse = async (message: AIMessage) => {
    const sourceIds = (message.metadata?.sources ?? []).map((source: any) => Number(source.id)).filter(Boolean);
    const sources = sourceIds.length ? `\n\nSources:\n${sourceIds.map((id: number) => `- [[bkemo/${id}|BK-${id}]]`).join('\n')}` : '';
    const saved = await blinko.upsertNote.call({
      content: `${message.content}${sources}`,
      references: [...new Set(sourceIds)],
      showToast: true,
      refresh: true,
    } as any);
    const created = Array.isArray(saved) ? saved[0] : saved;
    if (created?.id) onOpen(created as Note);
  };

  return <AIGlobalChat onOpen={onOpen} onSaveAssistant={saveAssistantResponse} />;
});
