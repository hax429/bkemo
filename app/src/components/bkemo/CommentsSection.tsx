import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import dayjs from '@/lib/dayjs';
import { api } from '@/lib/trpc';
import { getGuestId } from '@/lib/guestId';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';

type Comment = {
  id: number;
  content: string;
  guestName?: string | null;
  guestAvatar?: string | null;
  account?: { nickname?: string; name?: string; image?: string } | null;
  createdAt: string | Date;
};

/**
 * Redesigned inline comments for a memo card (owner view).
 */
export const CommentsSection = observer(function CommentsSection({
  noteId,
  onCountChange,
}: {
  noteId: number;
  onCountChange?: (n: number) => void;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.comments.list
      .query({ noteId, page: 1, size: 100, orderBy: 'asc' })
      .then((res: any) => {
        setComments(res.items ?? []);
        onCountChange?.(res.total ?? res.items?.length ?? 0);
      })
      .catch((e) => console.error('[comments] load failed:', e));
  };

  useEffect(() => {
    load();
    /* eslint-disable-next-line */
  }, [noteId]);

  const submit = async () => {
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      await api.comments.create.mutate({ noteId, content });
      setDraft('');
      load();
    } catch (e) {
      console.error('[comments] create failed:', e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await api.comments.delete.mutate({ id } as any);
      load();
    } catch (e) {
      console.error('[comments] delete failed:', e);
    }
  };

  const renderAvatar = (c: Comment) => {
    const avatarUrl = c.account?.image || c.guestAvatar;
    if (avatarUrl) {
      const src = avatarUrl.startsWith('http') ? avatarUrl : getBlinkoEndpoint(avatarUrl);
      return (
        <img
          src={src}
          style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover' }}
          alt="avatar"
        />
      );
    }
    const name = c.account?.nickname || c.account?.name || c.guestName || 'Anonymous';
    const initial = name.charAt(0).toUpperCase();
    return (
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: 'var(--accent-soft)',
          color: 'var(--accent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          fontWeight: 600,
          fontFamily: 'var(--font-mono)',
        }}
      >
        {initial}
      </div>
    );
  };

  return (
    <div
      style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: '1px solid var(--border-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto', paddingRight: 4 }}>
        {comments.map((c) => (
          <div
            key={c.id}
            className="h-stack hover-container"
            style={{ gap: 8, alignItems: 'flex-start', padding: '6px 8px', borderRadius: 'var(--radius)', background: 'var(--bg-3)' }}
          >
            {renderAvatar(c)}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="h-stack" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg)' }}>
                  {c.account?.nickname || c.account?.name || c.guestName || 'Anonymous'}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--fg-3)' }}>
                  {dayjs(c.createdAt).fromNow()}
                </span>
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--fg-2)',
                  lineHeight: 1.45,
                  whiteSpace: 'pre-wrap',
                  marginTop: 2,
                }}
              >
                {c.content}
              </div>
            </div>
            <span
              onClick={() => remove(c.id)}
              title="Delete"
              style={{
                cursor: 'pointer',
                color: 'var(--fg-3)',
                fontSize: 10,
                padding: '2px 4px',
                borderRadius: 4,
                transition: 'all 0.1s',
              }}
              className="delete-comment-btn"
            >
              ✕
            </span>
          </div>
        ))}
      </div>
      <div className="h-stack" style={{ gap: 8, marginTop: 4 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Add a comment…"
          style={{
            flex: 1,
            background: 'var(--bg)',
            color: 'var(--fg)',
            border: '1px solid var(--border-2)',
            borderRadius: 'var(--radius)',
            padding: '5px 10px',
            fontSize: 12.5,
            outline: 'none',
            transition: 'border-color 0.15s ease',
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border-2)')}
        />
        <button
          onClick={submit}
          disabled={!draft.trim() || busy}
          style={{
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius)',
            padding: '5px 12px',
            fontSize: 12,
            fontWeight: 500,
            opacity: draft.trim() ? 1 : 0.5,
            cursor: 'pointer',
            transition: 'opacity 0.15s ease',
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
});

/**
 * Beautiful and elegant reactions and comments wrapper block for the stream cards.
 */
export const CardFeedback = observer(function CardFeedback({
  note,
  onCountChange,
}: {
  note: any;
  onCountChange?: (n: number) => void;
}) {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const user = RootStore.Get(UserStore);
  const currentUserId = user.id;

  const [reactions, setReactions] = useState<{ emoji: string; count: number; reactedByMe: boolean }[]>([]);

  // Compute reactions count & user's status from raw notes reactions list
  useEffect(() => {
    const raw = note.reactions ?? [];
    const map = new Map<string, { count: number; reactedByMe: boolean }>();
    const me = currentUserId ? `acct:${currentUserId}` : '';
    for (const r of raw) {
      const e = map.get(r.emoji) ?? { count: 0, reactedByMe: false };
      e.count += 1;
      if (me && r.guestId === me) e.reactedByMe = true;
      map.set(r.emoji, e);
    }
    setReactions([...map.entries()].map(([emoji, v]) => ({ emoji, ...v })));
  }, [note.reactions, currentUserId]);

  const guestId = getGuestId();

  const handleToggleReaction = async (emoji: string) => {
    if (!note.id) return;
    setShowEmojiPicker(false);
    
    // Optimistic local state update
    setReactions((prev) => {
      const found = prev.find((r) => r.emoji === emoji);
      if (found) {
        const count = found.count + (found.reactedByMe ? -1 : 1);
        return prev
          .map((r) => (r.emoji === emoji ? { ...r, count, reactedByMe: !r.reactedByMe } : r))
          .filter((r) => r.count > 0);
      }
      return [...prev, { emoji, count: 1, reactedByMe: true }];
    });

    try {
      await api.reaction.toggle.mutate({ noteId: note.id, emoji, guestId });
      const fresh = await api.reaction.list.query({ noteId: note.id, guestId });
      setReactions(fresh);
    } catch (e) {
      console.error('[share] toggle failed:', e);
      const fresh = await api.reaction.list.query({ noteId: note.id, guestId });
      setReactions(fresh);
    }
  };

  if (note.isShare !== true) return null;

  const commentsCount = note._count?.comments ?? 0;
  const hasReactions = reactions.length > 0;
  const hasComments = commentsCount > 0;

  // Don't show at all if there are no reactions and no comments yet
  if (!hasReactions && !hasComments) return null;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        marginTop: 12,
        paddingTop: 10,
        borderTop: '1px dashed var(--border-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div className="h-stack" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Reaction badges */}
        {reactions.map((r) => (
          <button
            key={r.emoji}
            onClick={() => handleToggleReaction(r.emoji)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '3px 8px',
              borderRadius: 100,
              border: `1px solid ${r.reactedByMe ? 'var(--accent)' : 'var(--border-2)'}`,
              background: r.reactedByMe ? 'var(--accent-soft)' : 'var(--bg-3)',
              color: r.reactedByMe ? 'var(--accent)' : 'var(--fg-2)',
              fontSize: 11.5,
              cursor: 'pointer',
              fontWeight: 500,
              transition: 'all 0.15s ease',
            }}
          >
            <span>{r.emoji}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.85 }}>{r.count}</span>
          </button>
        ))}

        {/* Plus Picker */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowEmojiPicker((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              borderRadius: '50%',
              border: '1px solid var(--border-2)',
              background: 'var(--bg-3)',
              color: 'var(--fg-3)',
              fontSize: 11,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.color = 'var(--accent)';
            }}
            onMouseLeave={(e) => {
              if (!showEmojiPicker) {
                e.currentTarget.style.borderColor = 'var(--border-2)';
                e.currentTarget.style.color = 'var(--fg-3)';
              }
            }}
          >
            ＋
          </button>
          {showEmojiPicker && (
            <>
              <div
                onClick={() => setShowEmojiPicker(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 9 }}
              />
              <div
                className="h-stack"
                style={{
                  position: 'absolute',
                  top: 26,
                  left: 0,
                  zIndex: 10,
                  gap: 4,
                  padding: 4,
                  background: 'var(--bg-2)',
                  border: '1px solid var(--border-2)',
                  borderRadius: 10,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                }}
              >
                {['👍', '❤️', '🎉', '👀', '🔥', '💯'].map((emoji) => (
                  <span
                    key={emoji}
                    onClick={() => handleToggleReaction(emoji)}
                    style={{
                      cursor: 'pointer',
                      fontSize: 16,
                      padding: '4px 6px',
                      borderRadius: 6,
                      transition: 'background 0.1s',
                    }}
                    className="emoji-option"
                  >
                    {emoji}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Separator if both exist */}
        {hasReactions && hasComments && (
          <div style={{ width: 1, height: 12, background: 'var(--border-2)', margin: '0 4px' }} />
        )}

        {/* Comments label/trigger */}
        {hasComments ? (
          <span
            onClick={() => setCommentsOpen((v) => !v)}
            className="h-stack"
            style={{
              gap: 5,
              cursor: 'pointer',
              color: commentsOpen ? 'var(--accent)' : 'var(--fg-3)',
              fontSize: 11.5,
              padding: '3px 8px',
              borderRadius: 6,
              background: commentsOpen ? 'var(--accent-soft)' : 'transparent',
              transition: 'all 0.15s ease',
              fontWeight: 500,
            }}
          >
            <span>💬</span>
            <span>{commentsCount} comment{commentsCount === 1 ? '' : 's'}</span>
          </span>
        ) : (
          <span
            onClick={() => setCommentsOpen((v) => !v)}
            className="h-stack"
            style={{
              gap: 4,
              cursor: 'pointer',
              color: commentsOpen ? 'var(--accent)' : 'var(--fg-3)',
              fontSize: 11,
              padding: '3px 6px',
              borderRadius: 6,
              background: commentsOpen ? 'var(--accent-soft)' : 'transparent',
              transition: 'all 0.15s ease',
            }}
          >
            <span>💬</span>
            <span>Add comment</span>
          </span>
        )}
      </div>

      {commentsOpen && (
        <CommentsSection noteId={note.id!} onCountChange={onCountChange} />
      )}
    </div>
  );
});
