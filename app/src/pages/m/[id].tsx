import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import dayjs from '@/lib/dayjs';
import { api } from '@/lib/trpc';
import { getGuestId, getGuestName, setGuestName } from '@/lib/guestId';
import { MarkdownView } from '@/components/bkemo/MarkdownView';
import { observer } from 'mobx-react-lite';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import axios from 'axios';
import '@/styles/bkemo-theme.css';

const REACTION_PALETTE = ['👍', '❤️', '🎉', '👀', '🔥', '💯'];

type PublicNote = { id: number; content: string; createdAt?: string | Date; tags?: any[] } | null;
type Reaction = { emoji: string; count: number; reactedByMe: boolean };
type Comment = {
  id: number;
  content: string;
  guestName?: string | null;
  guestAvatar?: string | null;
  account?: { nickname?: string; name?: string; image?: string } | null;
  createdAt: string | Date;
};

const PublicMemoPage = observer(function PublicMemoPage() {
  const { id = '' } = useParams();
  const guestId = getGuestId();
  const [note, setNote] = useState<PublicNote>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState('');
  const [name, setName] = useState(getGuestName());
  const [showPicker, setShowPicker] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [guestAvatar, setGuestAvatar] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const user = RootStore.Get(UserStore);

  const loadNote = useCallback(async (pw?: string) => {
    setLoading(true);
    try {
      const res: any = await api.notes.publicDetail.mutate({ shareEncryptedUrl: id, password: pw });
      setHasPassword(!!res.hasPassword);
      if (res.data) {
        setNote(res.data);
      } else if (!res.hasPassword) {
        setNotFound(true);
      }
    } catch (e) {
      console.error('[share] load failed:', e);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadReactions = useCallback(async (noteId: number) => {
    try { setReactions(await api.reaction.list.query({ noteId, guestId }) as Reaction[]); }
    catch (e) { console.error('[share] reactions failed:', e); }
  }, [guestId]);

  const loadComments = useCallback(async (noteId: number) => {
    try {
      const res: any = await api.comments.list.query({ noteId, page: 1, size: 100, orderBy: 'desc' });
      setComments(res.items ?? []);
    } catch (e) { console.error('[share] comments failed:', e); }
  }, []);

  useEffect(() => { loadNote(); }, [loadNote]);
  useEffect(() => { if (note?.id) { loadReactions(note.id); loadComments(note.id); } }, [note?.id, loadReactions, loadComments]);

  const toggleReaction = async (emoji: string) => {
    if (!note?.id) return;
    setShowPicker(false);
    // optimistic
    setReactions((prev) => {
      const found = prev.find((r) => r.emoji === emoji);
      if (found) {
        const count = found.count + (found.reactedByMe ? -1 : 1);
        const next = prev.map((r) => r.emoji === emoji ? { ...r, count, reactedByMe: !r.reactedByMe } : r).filter((r) => r.count > 0);
        return next;
      }
      return [...prev, { emoji, count: 1, reactedByMe: true }];
    });
    try { await api.reaction.toggle.mutate({ noteId: note.id, emoji, guestId }); await loadReactions(note.id); }
    catch (e) { console.error('[share] toggle failed:', e); loadReactions(note.id); }
  };

  const submitComment = async () => {
    if (!note?.id || !draft.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (user.isLogin) {
        await api.comments.create.mutate({
          noteId: note.id,
          content: draft.trim(),
        });
      } else {
        setGuestName(name);
        await api.comments.create.mutate({
          noteId: note.id,
          content: draft.trim(),
          guestName: name.trim() || undefined,
          guestAvatar: guestAvatar || undefined,
        });
      }
      setDraft('');
      loadComments(note.id);
    } catch (e) {
      console.error('[share] comment failed:', e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await axios.post(getBlinkoEndpoint('/api/file/upload?isGuestAvatar=true'), formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      const path = response.data?.filePath || response.data?.path;
      if (path) {
        setGuestAvatar(path);
      }
    } catch (err) {
      console.error('Failed to upload guest avatar:', err);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const renderCommentAvatar = (c: Comment) => {
    const imgUrl = c.account?.image || c.guestAvatar;
    if (imgUrl) {
      const src = imgUrl.startsWith('http') ? imgUrl : getBlinkoEndpoint(imgUrl);
      return (
        <img
          src={src}
          style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', border: '1px solid rgba(255,255,255,0.1)' }}
          alt="avatar"
        />
      );
    }
    const nameVal = c.account?.nickname || c.account?.name || c.guestName || 'BK';
    const initial = nameVal.trim().charAt(0).toUpperCase() || 'B';
    return (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: 'rgba(255, 255, 255, 0.1)',
          color: 'rgba(255, 255, 255, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          fontWeight: 600,
          fontFamily: 'var(--font-mono)',
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        {initial}
      </div>
    );
  };

  return (
    <div
      className="bkemo bk-scroll"
      data-theme="dark"
      style={{
        position: 'fixed', inset: 0, zIndex: 100, overflow: 'auto',
        background: 'radial-gradient(1200px 800px at 20% 10%, #4b2db8 0%, transparent 55%), radial-gradient(1000px 700px at 90% 80%, #c23cc2 0%, transparent 55%), #0a0a12',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 20px 80px',
      }}
    >
      <div style={{ width: 'min(760px, 100%)' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.7)', fontFamily: 'var(--font-mono)', fontSize: 13, marginTop: '20vh' }}>Loading…</div>
        ) : notFound ? (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.8)', marginTop: '20vh' }}>This memo isn’t shared, or the link has expired.</div>
        ) : hasPassword && !note ? (
          <div style={{ maxWidth: 360, margin: '18vh auto 0', background: 'rgba(10,10,18,0.7)', backdropFilter: 'blur(20px)', border: '1px solid var(--border-2)', borderRadius: 16, padding: 24 }}>
            <div style={{ color: 'var(--fg)', fontSize: 15, fontWeight: 600, marginBottom: 12 }}>This memo is password-protected</div>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadNote(password)} placeholder="Enter password" style={{ width: '100%', background: 'var(--bg-2)', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 8, padding: '8px 12px', fontSize: 14 }} />
            <button onClick={() => loadNote(password)} style={{ marginTop: 12, width: '100%', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px', fontWeight: 500, cursor: 'pointer' }}>Unlock</button>
          </div>
        ) : note ? (
          <>
            {/* memo card */}
            <div style={{ background: 'rgba(10,10,18,0.55)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: '28px 32px', boxShadow: '0 24px 64px rgba(0,0,0,0.4)' }}>
              <div className="h-stack" style={{ gap: 10, marginBottom: 14 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>{note.createdAt ? dayjs(note.createdAt).format('YYYY-MM-DD HH:mm:ss') : ''}</span>
                <span className="spacer" />
                <span title="Copy link" onClick={() => navigator.clipboard?.writeText(window.location.href)} style={{ cursor: 'pointer', color: 'rgba(255,255,255,0.6)', fontSize: 15 }}>⧉</span>
                <span title="Comments" style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15 }}>💬</span>
              </div>
              <div style={{ color: '#fff' }}>
                <MarkdownView content={note.content ?? ''} />
              </div>
              {/* tags */}
              {Array.isArray(note.tags) && note.tags.length > 0 && (
                <div className="h-stack" style={{ gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
                  {note.tags.map((t: any) => (
                    <span key={t?.tag?.id ?? t?.id} style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 12, padding: '3px 10px', borderRadius: 6 }}>#{t?.tag?.name ?? t?.name}</span>
                  ))}
                </div>
              )}
              <div className="h-stack" style={{ gap: 6, marginTop: 18, color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>
                <span style={{ color: 'var(--accent)' }}>✦</span><span style={{ fontWeight: 600 }}>bkemo</span>
              </div>
            </div>

            {/* reactions */}
            <div className="h-stack" style={{ gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              {reactions.map((r) => (
                <button key={r.emoji} onClick={() => toggleReaction(r.emoji)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 100, border: `1px solid ${r.reactedByMe ? 'var(--accent)' : 'rgba(255,255,255,0.15)'}`, background: r.reactedByMe ? 'color-mix(in srgb, var(--accent) 25%, transparent)' : 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 14, cursor: 'pointer' }}>
                  <span>{r.emoji}</span><span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>{r.count}</span>
                </button>
              ))}
              <div style={{ position: 'relative' }}>
                <button onClick={() => setShowPicker((v) => !v)} style={{ padding: '4px 10px', borderRadius: 100, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 14, cursor: 'pointer' }}>＋</button>
                {showPicker && (
                  <div className="h-stack" style={{ position: 'absolute', top: 36, left: 0, zIndex: 10, gap: 4, padding: 6, background: 'var(--bg)', border: '1px solid var(--border-2)', borderRadius: 12, boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
                    {REACTION_PALETTE.map((e) => (
                      <span key={e} onClick={() => toggleReaction(e)} style={{ cursor: 'pointer', fontSize: 18, padding: 4, borderRadius: 6 }}>{e}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* comments */}
            <div style={{ marginTop: 28 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.06em', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', marginBottom: 12 }}>{comments.length} comment{comments.length === 1 ? '' : 's'}</div>

              {/* composer */}
              {user.isLogin ? (
                <div style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 16,
                  padding: 16,
                  marginBottom: 20,
                  boxShadow: '0 4px 20px rgba(0,0,0,0.15)'
                }}>
                  <div className="h-stack" style={{ gap: 10, marginBottom: 12, alignItems: 'center' }}>
                    {user.image ? (
                      <img src={user.image.startsWith('http') ? user.image : getBlinkoEndpoint(user.image)} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} alt="avatar" />
                    ) : (
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>
                        {(user.nickname || user.name || 'U').charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: 500 }}>
                      Commenting as <span style={{ color: '#fff', fontWeight: 600 }}>{user.nickname || user.name || 'Anonymous'}</span>
                    </span>
                  </div>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Add a comment…"
                    rows={3}
                    style={{
                      width: '100%',
                      background: 'rgba(0,0,0,0.15)',
                      color: '#fff',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 8,
                      padding: '10px 12px',
                      resize: 'vertical',
                      fontSize: 14,
                      outline: 'none',
                      fontFamily: 'inherit',
                      transition: 'border-color 0.15s ease'
                    }}
                    onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                    onBlur={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
                  />
                  <div className="h-stack" style={{ marginTop: 10 }}>
                    <span className="spacer" />
                    <button
                      onClick={submitComment}
                      disabled={!draft.trim() || isSubmitting}
                      style={{
                        background: 'var(--accent)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 8,
                        padding: '6px 16px',
                        fontSize: 13,
                        fontWeight: 500,
                        opacity: draft.trim() ? 1 : 0.5,
                        cursor: draft.trim() ? 'pointer' : 'default',
                        transition: 'opacity 0.15s ease'
                      }}
                    >
                      {isSubmitting ? 'Sending...' : 'Comment'}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 16,
                  padding: 16,
                  marginBottom: 20,
                  boxShadow: '0 4px 20px rgba(0,0,0,0.15)'
                }}>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      <div
                        onClick={() => document.getElementById('guest-avatar-input')?.click()}
                        style={{
                          position: 'relative',
                          width: 52,
                          height: 52,
                          borderRadius: '50%',
                          cursor: 'pointer',
                          overflow: 'hidden',
                          border: '2px solid rgba(255,255,255,0.15)',
                          background: 'rgba(255,255,255,0.05)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = 'var(--accent)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
                        }}
                        title="Click to upload custom avatar"
                      >
                        {uploadingAvatar ? (
                          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)', textAlign: 'center' }}>...</div>
                        ) : guestAvatar ? (
                          <img
                            src={guestAvatar.startsWith('http') ? guestAvatar : getBlinkoEndpoint(guestAvatar)}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            alt="Guest Avatar"
                          />
                        ) : (
                          <div style={{ fontSize: 20, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>
                            {(name.trim() || 'BK').substring(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            background: 'rgba(0,0,0,0.5)',
                            opacity: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 9,
                            color: '#fff',
                            fontWeight: 500,
                            transition: 'opacity 0.2s ease',
                          }}
                          className="upload-overlay"
                          onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                          onMouseLeave={(e) => e.currentTarget.style.opacity = '0'}
                        >
                          Upload
                        </div>
                      </div>
                      {guestAvatar && (
                        <span
                          onClick={() => setGuestAvatar(null)}
                          style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', cursor: 'pointer', transition: 'color 0.15s' }}
                          onMouseEnter={(e) => e.currentTarget.style.color = '#ff6b6b'}
                          onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}
                        >
                          Remove
                        </span>
                      )}
                    </div>

                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your name (optional, defaults to bk-xxxxxx)"
                        style={{
                          width: '100%',
                          background: 'rgba(0,0,0,0.15)',
                          color: '#fff',
                          border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: 8,
                          padding: '8px 12px',
                          fontSize: 13,
                          outline: 'none',
                          transition: 'border-color 0.15s ease'
                        }}
                        onFocus={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'}
                        onBlur={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
                      />
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="Add a comment…"
                        rows={3}
                        style={{
                          width: '100%',
                          background: 'rgba(0,0,0,0.15)',
                          color: '#fff',
                          border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: 8,
                          padding: '10px 12px',
                          resize: 'vertical',
                          fontSize: 14,
                          outline: 'none',
                          fontFamily: 'inherit',
                          transition: 'border-color 0.15s ease'
                        }}
                        onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                        onBlur={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
                      />
                      <div className="h-stack">
                        <span className="spacer" />
                        <button
                          onClick={submitComment}
                          disabled={!draft.trim() || isSubmitting}
                          style={{
                            background: 'var(--accent)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 8,
                            padding: '6px 16px',
                            fontSize: 13,
                            fontWeight: 500,
                            opacity: draft.trim() ? 1 : 0.5,
                            cursor: draft.trim() ? 'pointer' : 'default',
                            transition: 'opacity 0.15s ease'
                          }}
                        >
                          {isSubmitting ? 'Sending...' : 'Comment'}
                        </button>
                      </div>
                    </div>
                  </div>
                  <input
                    type="file"
                    id="guest-avatar-input"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                    style={{ display: 'none' }}
                  />
                </div>
              )}

              {/* comment list */}
              <div>
                {comments.map((c) => (
                  <div key={c.id} style={{ display: 'flex', gap: 12, padding: '16px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    {renderCommentAvatar(c)}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="h-stack" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ color: '#fff', fontSize: 13.5, fontWeight: 600 }}>
                          {c.account?.nickname || c.account?.name || c.guestName || 'Anonymous'}
                        </span>
                        {c.account && (
                          <span style={{
                            fontSize: 9.5,
                            background: 'rgba(75, 45, 184, 0.25)',
                            color: '#a78bfa',
                            padding: '1px 5px',
                            borderRadius: 4,
                            fontWeight: 500,
                            border: '1px solid rgba(167, 139, 250, 0.3)'
                          }}>
                            Member
                          </span>
                        )}
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
                          {dayjs(c.createdAt).fromNow()}
                        </span>
                      </div>
                      <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', marginTop: 4 }}>
                        {c.content}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
});

export default PublicMemoPage;
