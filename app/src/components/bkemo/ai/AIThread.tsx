import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from '@/lib/dayjs';
import { api, streamApi } from '@/lib/trpc';
import type { Note } from '@shared/lib/types';
import { MarkdownView } from '../MarkdownView';

export type AIThreadScope = 'global' | 'note';

export type AIConversation = {
  id: number;
  title?: string | null;
  scope?: string | null;
  noteId?: number | null;
  updatedAt?: Date | string;
  createdAt?: Date | string;
};

export type AIMessage = {
  id?: number;
  role: string;
  content: string;
  createdAt?: Date | string;
  metadata?: any;
};

export type AIConfigStatus = {
  mainModelReady: boolean;
  embeddingModelReady: boolean;
  mainModelTitle?: string | null;
  embeddingModelTitle?: string | null;
  providerCount: number;
  modelCount: number;
};

const BK_REF_RE = /@bk-(\d+)/gi;

function uniqueNumbers(values: number[]) {
  return [...new Set(values.filter(Boolean))];
}

function sourceIds(message: AIMessage) {
  const raw = message.metadata?.sources ?? [];
  return uniqueNumbers(raw.map((source: any) => Number(source.id)));
}

function contextIdsFromText(text: string, baseNoteId?: number) {
  return uniqueNumbers([...text.matchAll(BK_REF_RE)].map((match) => Number(match[1]))).filter((id) => id !== baseNoteId);
}

function conversationTitle(conversation: AIConversation) {
  const title = conversation.title?.trim();
  return title || `Chat ${conversation.id}`;
}

function useAIThread({
  scope,
  noteId,
  loadAllHistory = false,
}: {
  scope: AIThreadScope;
  noteId?: number;
  loadAllHistory?: boolean;
}) {
  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messagesByConversation, setMessagesByConversation] = useState<Record<number, AIMessage[]>>({});
  const [input, setInput] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [sending, setSending] = useState(false);
  const [withOnline, setWithOnline] = useState(false);
  const [configStatus, setConfigStatus] = useState<AIConfigStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? null,
    [activeId, conversations],
  );
  const activeMessages = activeId ? (messagesByConversation[activeId] ?? []) : (messagesByConversation[-1] ?? []);
  const contextNoteIds = contextIdsFromText(input, noteId);

  const loadMessages = async (conversationId: number) => {
    const detail = await api.conversation.detail.query({ id: conversationId });
    return ((detail as any)?.messages ?? []) as AIMessage[];
  };

  const refreshConversations = async (selectId?: number | null) => {
    setLoadingList(true);
    try {
      const list = await api.conversation.list.query({
        page: 1,
        size: scope === 'note' ? 20 : 50,
        scope,
        ...(scope === 'note' && noteId ? { noteId } : {}),
      } as any) as AIConversation[];
      setConversations(list);

      if (loadAllHistory) {
        const entries = await Promise.all(list.map(async (conversation) => {
          return [conversation.id, await loadMessages(conversation.id)] as const;
        }));
        setMessagesByConversation((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      }

      if (selectId !== undefined) {
        setActiveId(selectId);
      } else if (!activeId && list[0]?.id) {
        setActiveId(list[0].id);
      }
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    refreshConversations().catch((cause) => {
      console.error('[ai] conversation list failed:', cause);
      setError('AI conversations could not be loaded.');
      setLoadingList(false);
    });
    api.ai.configStatus.query()
      .then((status) => setConfigStatus(status as AIConfigStatus))
      .catch((cause) => {
        console.error('[ai] config status failed:', cause);
        setConfigStatus(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, noteId]);

  useEffect(() => {
    if (!activeId || loadAllHistory) return;
    let cancelled = false;
    loadMessages(activeId)
      .then((messages) => {
        if (!cancelled) setMessagesByConversation((prev) => ({ ...prev, [activeId]: messages }));
      })
      .catch((cause) => {
        console.error('[ai] conversation detail failed:', cause);
        if (!cancelled) setError('This conversation could not be opened.');
      });
    return () => { cancelled = true; };
  }, [activeId, loadAllHistory]);

  const startNew = () => {
    setActiveId(null);
    setMessagesByConversation((prev) => {
      const next = { ...prev };
      delete next[-1];
      return next;
    });
    setError(null);
  };

  const deleteActive = async () => {
    if (!activeId) return;
    await api.conversation.delete.mutate({ id: activeId });
    setMessagesByConversation((prev) => {
      const next = { ...prev };
      delete next[activeId];
      return next;
    });
    await refreshConversations(null);
  };

  const send = async () => {
    const question = input.trim();
    if (!question || sending) return;
    if (scope === 'note' && !noteId) {
      setError('Save this bkemo before starting a card AI chat.');
      return;
    }
    if (configStatus && !configStatus.mainModelReady) {
      setError('Choose a main chat model in Settings > AI before starting a chat.');
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setError('AI generation is online-only. Cached conversations are still readable.');
      return;
    }

    setSending(true);
    setError(null);
    setInput('');

    let conversationId = activeId ?? undefined;
    let assistantContent = '';
    const tempKey = conversationId ?? -1;
    const optimistic: AIMessage[] = [
      { role: 'user', content: question, createdAt: new Date() },
      { role: 'assistant', content: '', createdAt: new Date(), metadata: { streaming: true } },
    ];
    setMessagesByConversation((prev) => ({
      ...prev,
      [tempKey]: [...(prev[tempKey] ?? []), ...optimistic],
    }));

    try {
      const stream = await streamApi.ai.chat.mutate({
        conversationId,
        question,
        scope,
        ...(scope === 'note' ? { noteId } : {}),
        contextNoteIds,
        withOnline,
        withRAG: configStatus?.embeddingModelReady ?? false,
      } as any);

      for await (const event of stream as any) {
        if (event.conversation?.id && !conversationId) {
          conversationId = event.conversation.id;
          setActiveId(conversationId);
        }
        if (event.delta) {
          assistantContent += event.delta;
          setMessagesByConversation((prev) => {
            const key = conversationId ?? -1;
            const rows = [...(prev[key] ?? prev[-1] ?? [])];
            rows[rows.length - 1] = { ...rows[rows.length - 1], content: assistantContent };
            const next = { ...prev, [key]: rows };
            if (key !== -1) delete next[-1];
            return next;
          });
        }
        if (event.assistantMessage) {
          setMessagesByConversation((prev) => {
            const key = conversationId ?? -1;
            const rows = [...(prev[key] ?? prev[-1] ?? [])];
            rows[rows.length - 2] = event.userMessage ?? rows[rows.length - 2];
            rows[rows.length - 1] = event.assistantMessage;
            const next = { ...prev, [key]: rows };
            if (key !== -1) delete next[-1];
            return next;
          });
        }
      }
      await refreshConversations(conversationId ?? null);
    } catch (cause: any) {
      console.error('[ai] chat failed:', cause);
      setMessagesByConversation((prev) => {
        const key = conversationId ?? -1;
        const rows = [...(prev[key] ?? [])];
        return { ...prev, [key]: rows.slice(0, -2) };
      });
      setInput(question);
      setError(cause?.message || 'AI response failed.');
    } finally {
      setSending(false);
    }
  };

  return {
    activeConversation,
    activeId,
    activeMessages,
    configStatus,
    contextNoteIds,
    conversations,
    deleteActive,
    error,
    input,
    loadingList,
    messagesByConversation,
    refreshConversations,
    send,
    sending,
    setActiveId,
    setInput,
    setWithOnline,
    startNew,
    withOnline,
  };
}

function AIConfigNotice({ status }: { status: AIConfigStatus | null }) {
  if (!status) return null;
  if (!status.mainModelReady) {
    return (
      <div className="bk-ai-runtime-notice is-danger">
        <div>AI is not configured yet.</div>
        <p>Add a provider, create an inference-capable model, then choose it as the main chat model in Settings &gt; AI.</p>
      </div>
    );
  }
  if (!status.embeddingModelReady) {
    return (
      <div className="bk-ai-runtime-notice">
        Chat model ready{status.mainModelTitle ? `: ${status.mainModelTitle}` : ''}. Add an embedding model if you want AI to search bkemos as context.
      </div>
    );
  }
  return null;
}

function AIMessageList({
  messages,
  sending,
  onOpen,
  onSaveAssistant,
}: {
  messages: AIMessage[];
  sending: boolean;
  onOpen: (note: Note) => void;
  onSaveAssistant?: (message: AIMessage) => void | Promise<void>;
}) {
  if (messages.length === 0) {
    return <div className="bk-ai-empty-chat">Ask about your bkemos.</div>;
  }
  return (
    <>
      {messages.map((message, index) => {
        const assistant = message.role === 'assistant';
        const ids = sourceIds(message);
        return (
          <article key={message.id ?? `${message.role}-${index}`} className={assistant ? 'bk-ai-message is-assistant' : 'bk-ai-message is-user'}>
            <div className="bk-ai-message-role">{assistant ? 'AI' : 'You'}</div>
            {assistant ? (
              <MarkdownView content={message.content || (sending ? 'Thinking...' : '')} />
            ) : (
              <div className="bk-ai-user-content">{message.content}</div>
            )}
            {ids.length > 0 ? (
              <div className="h-stack bk-ai-source-list">
                {ids.map((id) => (
                  <button key={id} onClick={() => api.notes.detail.mutate({ id }).then((note) => note && onOpen(note as Note))}>
                    BK-{id}
                  </button>
                ))}
              </div>
            ) : null}
            {assistant && message.content ? (
              <div className="h-stack bk-ai-message-actions">
                <button onClick={() => navigator.clipboard?.writeText(message.content)}>Copy</button>
                {onSaveAssistant ? <button onClick={() => onSaveAssistant(message)}>Save as bkemo</button> : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </>
  );
}

function AIComposer({
  contextNoteIds,
  disabled,
  error,
  input,
  noteId,
  onOpen,
  onSend,
  sending,
  setInput,
}: {
  contextNoteIds: number[];
  disabled?: boolean;
  error?: string | null;
  input: string;
  noteId?: number;
  onOpen: (note: Note) => void;
  onSend: () => void;
  sending: boolean;
  setInput: (value: string) => void;
}) {
  return (
    <div className="bk-ai-composer-wrap">
      {contextNoteIds.length > 0 ? (
        <div className="h-stack bk-ai-context-list">
          {contextNoteIds.map((id) => (
            <button key={id} onClick={() => api.notes.detail.mutate({ id }).then((note) => note && onOpen(note as Note))}>
              + BK-{id}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <div className="bk-ai-error">{error}</div> : null}
      <div className="h-stack bk-ai-composer">
        <textarea
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') onSend();
          }}
          placeholder={noteId ? 'Talk with AI about this card. Use @bk-5 to add context.' : 'Message AI...'}
          rows={2}
        />
        <button onClick={onSend} disabled={!input.trim() || sending || disabled}>
          {sending ? 'Sending' : 'Send'}
        </button>
      </div>
    </div>
  );
}

function AIConversationSidebar({
  activeId,
  conversations,
  loading,
  onDelete,
  onNew,
  onSelect,
}: {
  activeId: number | null;
  conversations: AIConversation[];
  loading: boolean;
  onDelete: () => void;
  onNew: () => void;
  onSelect: (id: number) => void;
}) {
  return (
    <aside className="bk-scroll bk-ai-sidebar">
      <button className="bk-ai-new-chat" onClick={onNew}>New chat</button>
      {loading ? (
        <div className="bk-ai-sidebar-empty">Loading...</div>
      ) : conversations.length === 0 ? (
        <div className="bk-ai-sidebar-empty">No AI chats yet.</div>
      ) : conversations.map((conversation) => {
        const active = conversation.id === activeId;
        return (
          <button
            key={conversation.id}
            className={active ? 'bk-ai-conversation is-active' : 'bk-ai-conversation'}
            onClick={() => onSelect(conversation.id)}
          >
            <span>{conversationTitle(conversation)}</span>
            <small>{conversation.updatedAt ? dayjs(conversation.updatedAt).format('MMM D HH:mm') : `BK-AI-${conversation.id}`}</small>
          </button>
        );
      })}
      {activeId ? <button className="bk-ai-delete-chat" onClick={onDelete}>Delete current chat</button> : null}
    </aside>
  );
}

export const AIGlobalChat = observer(function AIGlobalChat({
  onOpen,
  onSaveAssistant,
}: {
  onOpen: (note: Note) => void;
  onSaveAssistant: (message: AIMessage) => void | Promise<void>;
}) {
  const thread = useAIThread({ scope: 'global' });
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [thread.activeMessages, thread.sending]);

  return (
    <div className="h-stack bk-ai-shell">
      <AIConversationSidebar
        activeId={thread.activeId}
        conversations={thread.conversations}
        loading={thread.loadingList}
        onDelete={thread.deleteActive}
        onNew={thread.startNew}
        onSelect={thread.setActiveId}
      />
      <main className="v-stack bk-ai-main">
        <header className="h-stack bk-ai-header">
          <span>{thread.activeConversation ? conversationTitle(thread.activeConversation) : 'AI'}</span>
          <span className="spacer" />
          <label className="h-stack">
            <input type="checkbox" checked={thread.withOnline} onChange={(event) => thread.setWithOnline(event.currentTarget.checked)} />
            web
          </label>
        </header>
        <div className="bk-scroll bk-ai-messages">
          <div className="bk-ai-message-column">
            <AIConfigNotice status={thread.configStatus} />
            <AIMessageList messages={thread.activeMessages} sending={thread.sending} onOpen={onOpen} onSaveAssistant={onSaveAssistant} />
            <div ref={endRef} />
          </div>
        </div>
        <AIComposer
          contextNoteIds={thread.contextNoteIds}
          disabled={thread.configStatus?.mainModelReady === false}
          error={thread.error}
          input={thread.input}
          onOpen={onOpen}
          onSend={thread.send}
          sending={thread.sending}
          setInput={thread.setInput}
        />
      </main>
    </div>
  );
});

export const NoteAIThread = observer(function NoteAIThread({
  note,
  onOpen,
}: {
  note: Note;
  onOpen: (note: Note) => void;
}) {
  const thread = useAIThread({ scope: 'note', noteId: note.id, loadAllHistory: true });

  if (!note.id) {
    return <div className="bk-ai-note-hint">Save this bkemo before starting a card AI chat.</div>;
  }

  const conversations = thread.conversations.length
    ? thread.conversations
    : (thread.messagesByConversation[-1]?.length ? [{ id: -1, createdAt: new Date(), title: 'Current thread' }] as AIConversation[] : []);

  return (
    <section className="bk-ai-note-thread">
      <div className="h-stack bk-ai-note-head">
        <span>AI chat</span>
        <small>{thread.conversations.length ? `${thread.conversations.length} thread${thread.conversations.length === 1 ? '' : 's'}` : 'private'}</small>
        <span className="spacer" />
        <button onClick={thread.startNew}>New chat</button>
      </div>
      <div className="v-stack bk-ai-note-history">
        {conversations.map((conversation) => {
          const rows = thread.messagesByConversation[conversation.id] ?? [];
          if (rows.length === 0) return null;
          return (
            <div key={conversation.id} className="bk-ai-note-card">
              <div className="bk-ai-note-card-title">
                {conversation.id === -1 ? 'Current thread' : `Thread ${dayjs(conversation.createdAt).format('MMM D HH:mm')}`}
              </div>
              <AIMessageList messages={rows} sending={thread.sending} onOpen={onOpen} />
            </div>
          );
        })}
        <AIComposer
          contextNoteIds={thread.contextNoteIds}
          disabled={thread.configStatus?.mainModelReady === false}
          error={thread.error}
          input={thread.input}
          noteId={note.id}
          onOpen={onOpen}
          onSend={thread.send}
          sending={thread.sending}
          setInput={thread.setInput}
        />
      </div>
    </section>
  );
});
