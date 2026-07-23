import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from '@/lib/dayjs';
import { api, streamApi } from '@/lib/trpc';
import type { Note } from '@shared/lib/types';
import { aiDebugLog, describeAiError, isAiDebugEnabled } from '@/lib/aiDebug';
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

function firstWords(content: string, count = 10) {
  return content
    .replace(/[#*_`>~\[\]()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, count)
    .join(' ');
}

function updateStreamingAssistant(
  rows: AIMessage[],
  content: string,
): AIMessage[] {
  const next = [...rows];
  let index = next.length - 1;
  while (index >= 0 && next[index].role !== 'assistant') index -= 1;
  if (index < 0) {
    next.push({ role: 'assistant', content, createdAt: new Date(), metadata: { streaming: true } });
  } else {
    next[index] = { ...next[index], content, metadata: { ...(next[index].metadata || {}), streaming: true } };
  }
  return next;
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
  const sendingRef = useRef(false);
  sendingRef.current = sending;

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

  const refreshConversations = async (selectId?: number | null, reloadMessages = false) => {
    setLoadingList(true);
    try {
      const list = await api.conversation.list.query({
        page: 1,
        size: scope === 'note' ? 20 : 50,
        scope,
        ...(scope === 'note' && noteId ? { noteId } : {}),
      } as any) as AIConversation[];
      setConversations(list);

      if (loadAllHistory || reloadMessages) {
        const targets = loadAllHistory
          ? list
          : list.filter((conversation) => conversation.id === (selectId ?? activeId));
        const entries = await Promise.all(targets.map(async (conversation) => {
          return [conversation.id, await loadMessages(conversation.id)] as const;
        }));
        setMessagesByConversation((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      }

      if (selectId !== undefined) {
        setActiveId(selectId);
      } else if (!activeId && list[0]?.id && scope === 'note') {
        // Note AI is one thread per card. Global AI stays on "New chat" until
        // the user picks a thread or sends (which creates a conversation).
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
    // Mid-stream reloads wipe the optimistic assistant bubble and can overwrite
    // user bubbles with deltas — skip while a send is in flight.
    if (sendingRef.current) return;
    let cancelled = false;
    loadMessages(activeId)
      .then((messages) => {
        if (!cancelled && !sendingRef.current) {
          setMessagesByConversation((prev) => ({ ...prev, [activeId]: messages }));
        }
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
    if (configStatus && !configStatus.embeddingModelReady) {
      setError('Choose an embedding model in Settings > AI, then rebuild the embedding index.');
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
    let createdThisSend = !conversationId;
    let assistantContent = '';
    const tempKey = conversationId ?? -1;
    const debug = isAiDebugEnabled();
    const t0 = Date.now();
    const optimistic: AIMessage[] = [
      { role: 'user', content: question, createdAt: new Date() },
      { role: 'assistant', content: '', createdAt: new Date(), metadata: { streaming: true } },
    ];
    setMessagesByConversation((prev) => ({
      ...prev,
      [tempKey]: [...(prev[tempKey] ?? []), ...optimistic],
    }));

    aiDebugLog('client:send', {
      scope,
      noteId: noteId ?? null,
      conversationId: conversationId ?? null,
      contextNoteIds,
      question,
      withRAG: scope === 'global',
    });

    try {
      const stream = await streamApi.ai.chat.mutate({
        conversationId,
        question,
        scope,
        ...(scope === 'note' ? { noteId } : {}),
        contextNoteIds,
        // Tavily web search: global chat only; stays off until Settings exposes a key again.
        withOnline: scope === 'global' ? withOnline : false,
        withRAG: scope === 'global',
        ...(debug ? { debug: true } : {}),
      } as any);
      aiDebugLog('client:stream_open', { ms: Date.now() - t0 });

      let eventCount = 0;
      let firstDeltaMs: number | null = null;
      for await (const event of stream as any) {
        eventCount += 1;
        if (event?.debug) {
          aiDebugLog(String(event.debug.phase || 'server'), event.debug, 'server');
        }
        if (event.conversation?.id && !conversationId) {
          conversationId = event.conversation.id;
          createdThisSend = true;
          setActiveId(conversationId);
          // Show the new thread in the sidebar immediately (title refined by AI after).
          setConversations((prev) => {
            if (prev.some((row) => row.id === conversationId)) return prev;
            return [
              {
                id: conversationId!,
                title: question.slice(0, 80),
                updatedAt: new Date().toISOString(),
                scope,
                noteId: noteId ?? null,
              },
              ...prev,
            ];
          });
          aiDebugLog('client:conversation', { conversationId }, 'event');
        }
        if (event.notes) {
          aiDebugLog('client:notes', {
            count: Array.isArray(event.notes) ? event.notes.length : 0,
            ids: Array.isArray(event.notes) ? event.notes.map((note: any) => note.id) : [],
          }, 'event');
        }
        if (event.status) {
          aiDebugLog('client:status', { status: event.status }, 'event');
        }
        if (event.delta) {
          if (firstDeltaMs == null) {
            firstDeltaMs = Date.now() - t0;
            aiDebugLog('client:first_delta', { firstDeltaMs, preview: String(event.delta).slice(0, 80) }, 'event');
          }
          assistantContent += event.delta;
          setMessagesByConversation((prev) => {
            const key = conversationId ?? -1;
            const rows = updateStreamingAssistant(prev[key] ?? prev[-1] ?? [], assistantContent);
            const next = { ...prev, [key]: rows };
            if (key !== -1) delete next[-1];
            return next;
          });
        }
        if (event.assistantMessage) {
          aiDebugLog('client:assistant_message', {
            id: event.assistantMessage?.id,
            chars: String(event.assistantMessage?.content || '').length,
          }, 'event');
          setMessagesByConversation((prev) => {
            const key = conversationId ?? -1;
            const rows = updateStreamingAssistant(prev[key] ?? prev[-1] ?? [], event.assistantMessage.content ?? assistantContent);
            const last = rows.length - 1;
            rows[last] = event.assistantMessage;
            if (event.userMessage && last >= 1 && rows[last - 1]?.role === 'user') {
              rows[last - 1] = event.userMessage;
            }
            const next = { ...prev, [key]: rows };
            if (key !== -1) delete next[-1];
            return next;
          });
        }
      }
      aiDebugLog('client:stream_end', {
        ms: Date.now() - t0,
        eventCount,
        firstDeltaMs,
        chars: assistantContent.length,
      });

      await refreshConversations(conversationId ?? null, true);
      aiDebugLog('client:done', { ms: Date.now() - t0, conversationId: conversationId ?? null });

      // Name brand-new threads in the background (after refresh so it can't be clobbered).
      if (createdThisSend && conversationId && assistantContent.trim()) {
        const namedId = conversationId;
        void api.ai.summarizeConversationTitle.mutate({
          conversationId: namedId,
          conversations: [
            { role: 'user', content: question },
            { role: 'assistant', content: assistantContent },
          ],
        }).then((updated: any) => {
          if (!updated?.title) return;
          setConversations((prev) => prev.map((row) => (
            row.id === namedId ? { ...row, title: updated.title } : row
          )));
          aiDebugLog('client:title', { conversationId: namedId, title: updated.title }, 'event');
        }).catch((cause) => {
          console.error('[ai] title summarize failed:', cause);
        });
      }
    } catch (cause: any) {
      const info = describeAiError(cause);
      aiDebugLog(
        info.aborted ? 'client:aborted' : 'client:error',
        { ...info, ms: Date.now() - t0 },
        'error',
        info.aborted
          ? (info.timeoutLike && (Date.now() - t0) >= 290_000
            ? 'Stream aborted by client timeout while waiting on the model (no first token). Check server:stream_waiting / DeepSeek thinking.'
            : 'Stream aborted (BodyStreamBuffer / AbortError). Often navigation, remount, or a cancelled fetch.')
          : info.message,
      );
      console.error('[ai] chat failed:', cause);
      setMessagesByConversation((prev) => {
        const key = conversationId ?? -1;
        const rows = [...(prev[key] ?? prev[-1] ?? [])];
        // Drop the optimistic user+assistant pair when present.
        const trimmed = rows.length >= 2 && rows[rows.length - 1]?.role === 'assistant'
          ? rows.slice(0, -2)
          : rows;
        const next = { ...prev, [key]: trimmed };
        if (key !== -1) delete next[-1];
        return next;
      });
      setInput(question);
      setError(
        info.aborted
          ? 'AI stream was aborted before a full reply arrived. Check the AI debug channel if enabled.'
          : (info.message || 'AI response failed.'),
      );
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
      <div className="bk-ai-runtime-notice is-danger">
        <div>Embedding model required.</div>
        <p>
          Main chat is ready{status.mainModelTitle ? ` (${status.mainModelTitle})` : ''}.
          Choose an embedding-capable model in Settings &gt; AI, then rebuild the embedding index before using AI.
        </p>
      </div>
    );
  }
  return null;
}

function aiReady(status: AIConfigStatus | null) {
  return !!status?.mainModelReady && !!status?.embeddingModelReady;
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
    return (
      <div className="bk-ai-empty-chat">
        <div className="bk-ai-empty-greeting">
          <div className="bk-ai-dialog-kicker">AI</div>
          <h3>Ask about your bkemos</h3>
          <p>Search patterns, clarify values, or pull up what you wrote — grounded in your notes.</p>
        </div>
      </div>
    );
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
              <div className="bk-ai-assistant-body">
                <MarkdownView content={message.content || (sending ? 'Thinking...' : '')} />
              </div>
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

type BkMentionItem = { id: number; label: string; hint: string };

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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [cursor, setCursor] = useState(0);
  const [mentions, setMentions] = useState<BkMentionItem[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionOpen, setMentionOpen] = useState(false);

  const mentionQuery = useMemo(() => {
    const before = input.slice(0, cursor);
    const match = before.match(/(^|[\s([{])@bk-(\d*)$/i);
    if (!match) return null;
    return { prefix: match[1] ?? '', digits: match[2] ?? '', start: before.length - match[0].length + match[1].length };
  }, [cursor, input]);

  useEffect(() => {
    if (!mentionQuery) {
      setMentionOpen(false);
      setMentions([]);
      return;
    }
    let cancelled = false;
    const q = mentionQuery.digits;
    api.notes.list.mutate({
      page: 1,
      size: 12,
      searchText: q ? undefined : '',
      orderBy: 'desc',
      type: -1,
      isArchived: false,
      isRecycle: false,
    } as any)
      .then(async (rows) => {
        let list = ((rows as any[]) ?? [])
          .filter((note) => note?.id && note.id !== noteId)
          .map((note) => ({
            id: Number(note.id),
            label: `BK-${note.id}`,
            hint: firstWords(String(note.content || ''), 10) || 'Empty memo',
          }));
        if (q) {
          list = list.filter((item) => String(item.id).startsWith(q));
          if (!list.some((item) => String(item.id) === q) && Number(q) > 0) {
            try {
              const exact = await api.notes.detail.mutate({ id: Number(q) });
              if (exact?.id && exact.id !== noteId) {
                list = [{
                  id: Number(exact.id),
                  label: `BK-${exact.id}`,
                  hint: firstWords(String(exact.content || ''), 10) || 'Empty memo',
                }, ...list];
              }
            } catch {
              // ignore missing ids while typing
            }
          }
        }
        if (!cancelled) {
          setMentions(list.slice(0, 8));
          setMentionIndex(0);
          setMentionOpen(list.length > 0);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMentions([]);
          setMentionOpen(false);
        }
      });
    return () => { cancelled = true; };
  }, [mentionQuery?.digits, mentionQuery?.start, noteId]);

  const applyMention = (item: BkMentionItem) => {
    if (!mentionQuery) return;
    const before = input.slice(0, mentionQuery.start);
    const after = input.slice(cursor);
    const next = `${before}@bk-${item.id} ${after}`;
    setInput(next);
    setMentionOpen(false);
    const nextCursor = before.length + `@bk-${item.id} `.length;
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCursor, nextCursor);
      setCursor(nextCursor);
    });
  };

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
      <div className="bk-ai-composer">
        {mentionOpen && mentions.length > 0 ? (
          <div className="bk-suggest-menu" role="listbox" aria-label="Memo references">
            {mentions.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={index === mentionIndex}
                className={index === mentionIndex ? 'bk-suggest-row is-active' : 'bk-suggest-row'}
                onMouseDown={(event) => {
                  event.preventDefault();
                  applyMention(item);
                }}
                onMouseEnter={() => setMentionIndex(index)}
              >
                <span className="bk-suggest-label">{item.label}</span>
                <span className="bk-suggest-hint">{item.hint}</span>
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => {
            setInput(event.currentTarget.value);
            setCursor(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
          }}
          onClick={(event) => setCursor(event.currentTarget.selectionStart ?? 0)}
          onKeyUp={(event) => setCursor(event.currentTarget.selectionStart ?? 0)}
          onKeyDown={(event) => {
            if (mentionOpen && mentions.length > 0) {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setMentionIndex((index) => (index + 1) % mentions.length);
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setMentionIndex((index) => (index - 1 + mentions.length) % mentions.length);
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                applyMention(mentions[mentionIndex]);
                return;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setMentionOpen(false);
                return;
              }
            }
            if (event.key !== 'Enter') return;
            if (event.shiftKey) return;
            event.preventDefault();
            if (!disabled && !sending && input.trim()) onSend();
          }}
          placeholder={noteId ? 'Talk about this card… @bk-5 adds context. Enter to send.' : 'Message AI… Enter to send, Shift+Enter for a new line'}
          rows={2}
        />
        <div className="h-stack bk-ai-composer-actions">
          <span className="bk-ai-composer-hint">Enter send · Shift+Enter newline</span>
          <span className="spacer" />
          <button type="button" onClick={onSend} disabled={!input.trim() || sending || disabled}>
            {sending ? 'Sending' : 'Send'}
          </button>
        </div>
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
          <div className="v-stack bk-ai-header-copy">
            <span>{thread.activeConversation ? conversationTitle(thread.activeConversation) : 'New chat'}</span>
            <small>Grounded in your notes</small>
          </div>
          <span className="spacer" />
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
          disabled={!aiReady(thread.configStatus)}
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

  // One conversation per note; merge history from the active/newest thread for display.
  const historyMessages = (() => {
    if (thread.activeId && thread.messagesByConversation[thread.activeId]) {
      return thread.messagesByConversation[thread.activeId];
    }
    if (thread.conversations[0]?.id != null) {
      return thread.messagesByConversation[thread.conversations[0].id] ?? [];
    }
    return thread.messagesByConversation[-1] ?? [];
  })();

  return (
    <section className="bk-ai-note-thread">
      <div className="h-stack bk-ai-note-head">
        <span>AI chat</span>
        <small>About this card · use @bk-5 to add context</small>
      </div>
      <AIConfigNotice status={thread.configStatus} />
      <div className="v-stack bk-ai-note-history">
        <div className="bk-ai-note-card">
          <AIMessageList messages={historyMessages} sending={thread.sending} onOpen={onOpen} />
        </div>
        <AIComposer
          contextNoteIds={thread.contextNoteIds}
          disabled={!aiReady(thread.configStatus)}
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
