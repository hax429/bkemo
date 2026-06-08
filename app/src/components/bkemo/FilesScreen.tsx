import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import dayjs from '@/lib/dayjs';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';
import { api } from '@/lib/trpc';
import { eventBus } from '@/lib/event';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { noteLinkTitle } from '@/lib/noteLinks';
import { AttachmentViewer, type ViewerItem } from './AttachmentViewer';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' };

type FileKind = 'image' | 'audio' | 'video' | 'file';
type FileRow = {
  id: number; name: string; path: string; type: string | null; size: string | null;
  noteId: number | null; createdAt: Date | string | null;
  note: { id: number; content: string } | null;
};

const IMG = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'heic'];
const AUD = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus'];
const VID = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'];

function fileKind(type?: string | null, name?: string): FileKind {
  const t = (type ?? '').toLowerCase();
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('video/')) return 'video';
  const ext = (name ?? '').split('.').pop()?.toLowerCase() ?? '';
  if (IMG.includes(ext)) return 'image';
  if (AUD.includes(ext)) return 'audio';
  if (VID.includes(ext)) return 'video';
  return 'file';
}

const KIND_ICON: Record<FileKind, string> = { image: '▣', audio: '♪', video: '▶', file: '◳' };

function humanSize(size: string | null): string {
  const n = Number(size ?? 0);
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const TABS: { id: FileKind | 'all'; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'image', label: 'Images' }, { id: 'audio', label: 'Audio' },
  { id: 'video', label: 'Video' }, { id: 'file', label: 'Files' },
];

export const FilesScreen = observer(function FilesScreen() {
  const user = RootStore.Get(UserStore);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<FileKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [viewer, setViewer] = useState<number | null>(null);

  const token = user.token ?? '';
  const fileUrl = (p: string) => getBlinkoEndpoint(`${p}${p.includes('?') ? '&' : '?'}token=${token}`);

  const load = async () => {
    setLoading(true);
    try { setRows(await api.attachments.allFiles.query({}) as any); }
    catch (e) { console.error('[files] load failed:', e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const remove = async (r: FileRow) => {
    if (!window.confirm(`Delete “${r.name}”? This removes the file permanently.`)) return;
    try { await api.attachments.delete.mutate({ id: r.id }); setRows((p) => p.filter((x) => x.id !== r.id)); }
    catch (e) { console.error('[files] delete failed:', e); }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab !== 'all' && fileKind(r.type, r.name) !== tab) return false;
      if (q && !(`${r.name} ${r.note?.content ?? ''}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, tab, query]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, image: 0, audio: 0, video: 0, file: 0 };
    rows.forEach((r) => { c[fileKind(r.type, r.name)]++; });
    return c;
  }, [rows]);

  return (
    <div className="v-stack" style={{ flex: 1, height: '100%', overflow: 'hidden', background: 'var(--bg)' }}>
      {/* topbar */}
      <div className="h-stack" style={{ height: 44, padding: '0 18px', borderBottom: '1px solid var(--border)', gap: 12, background: 'var(--bg)', flexShrink: 0 }}>
        <span style={{ color: 'var(--fg)', fontSize: 13, fontWeight: 600 }}>Files</span>
        <span style={{ color: 'var(--fg-3)' }}>/</span>
        <span style={{ color: 'var(--fg-2)', fontSize: 13 }}>Attachments</span>
        <span className="spacer" />
        <span style={mono}>{filtered.length} of {rows.length}</span>
      </div>

      {/* controls */}
      <div className="h-stack" style={{ padding: '12px 18px', gap: 8, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <span key={t.id} onClick={() => setTab(t.id)} style={{ padding: '4px 12px', borderRadius: 100, fontSize: 12.5, cursor: 'pointer', border: `1px solid ${tab === t.id ? 'var(--accent)' : 'var(--border-2)'}`, background: tab === t.id ? 'var(--accent-soft)' : 'transparent', color: tab === t.id ? 'var(--accent)' : 'var(--fg-2)' }}>
            {t.label} <span style={{ ...mono, color: 'inherit', opacity: 0.7 }}>{counts[t.id]}</span>
          </span>
        ))}
        <span className="spacer" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files & memos…" style={{ background: 'var(--bg-2)', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', padding: '6px 10px', fontSize: 12.5, outline: 'none', minWidth: 200 }} />
      </div>

      {/* list */}
      <div className="bk-scroll" style={{ flex: 1, overflow: 'auto', padding: '12px 18px 40px' }}>
        {loading ? (
          <div style={{ ...mono, padding: 24, textAlign: 'center' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ ...mono, padding: 24, textAlign: 'center' }}>No files{query || tab !== 'all' ? ' match this filter.' : ' yet. Attach files to a memo to see them here.'}</div>
        ) : (
          <div className="v-stack" style={{ gap: 6 }}>
            {filtered.map((r, i) => {
              const kind = fileKind(r.type, r.name);
              const url = fileUrl(r.path);
              return (
                <div key={r.id} className="h-stack" style={{ gap: 12, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-2)', alignItems: 'center' }}>
                  {/* thumbnail / icon — opens the viewer */}
                  <div onClick={() => setViewer(i)} style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 8, overflow: 'hidden', background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-3)', fontSize: 18, border: '1px solid var(--border)', cursor: 'pointer' }}>
                    {kind === 'image'
                      ? <img src={url} alt={r.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <span style={{ color: 'var(--accent)' }}>{KIND_ICON[kind]}</span>}
                  </div>
                  {/* name + source */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span onClick={() => setViewer(i)} style={{ fontSize: 13.5, color: 'var(--fg)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{r.name}</span>
                    <div className="h-stack" style={{ gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                      <span style={mono}>{kind} · {humanSize(r.size)}{r.createdAt ? ` · ${dayjs(r.createdAt).format('MMM D, YYYY')}` : ''}</span>
                      {r.note
                        ? <span onClick={() => eventBus.emit('bkemo:open-note', { id: r.note!.id })} title="Open source memo" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--accent)', cursor: 'pointer', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)', borderRadius: 100, padding: '1px 8px' }}>↳ BK-{r.note.id} {noteLinkTitle(r.note.content).slice(0, 40)}</span>
                        : <span style={{ ...mono, opacity: 0.7 }}>unattached</span>}
                    </div>
                  </div>
                  {/* actions */}
                  <a href={url} target="_blank" rel="noreferrer" title="Open" style={{ color: 'var(--fg-3)', fontSize: 13, padding: '4px 8px', textDecoration: 'none', flexShrink: 0 }}>↗</a>
                  <span onClick={() => remove(r)} title="Delete" style={{ color: '#E0696B', fontSize: 13, padding: '4px 8px', cursor: 'pointer', flexShrink: 0 }}>⌫</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {viewer != null && (
        <AttachmentViewer
          items={filtered.map((r): ViewerItem => ({ path: r.path, name: r.name, type: r.type }))}
          index={viewer}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
});
