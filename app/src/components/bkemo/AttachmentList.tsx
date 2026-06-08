import { useState } from 'react';
import { attachmentUrl, attachmentKind, KIND_ICON, humanSize } from '@/lib/attachments';
import { AttachmentViewer, type ViewerItem } from './AttachmentViewer';

type Att = { path: string; name: string; type?: string | null; size?: number | string | null };

const cardBase: React.CSSProperties = {
  border: '1px solid var(--border-2)', borderRadius: 10, overflow: 'hidden',
  background: 'var(--bg)', cursor: 'pointer', flexShrink: 0,
};

/** Attachments section for a memo card: image/PDF previews + file chips → viewer. */
export function AttachmentList({ attachments, compact }: { attachments: Att[] | undefined; compact?: boolean }) {
  const [viewer, setViewer] = useState<number | null>(null);
  const items = (attachments ?? []).filter((a) => a && a.path);
  if (items.length === 0) return null;

  const viewerItems: ViewerItem[] = items.map((a) => ({ path: a.path, name: a.name, type: a.type }));
  const imgH = compact ? 120 : 200;

  return (
    <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11, marginBottom: 8 }}>
        <span>📎</span><span>Attachments ({items.length})</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {items.map((a, i) => {
          const kind = attachmentKind(a.type, a.name);
          const url = attachmentUrl(a.path);
          const open = () => setViewer(i);

          if (kind === 'image') {
            return (
              <div key={a.path + i} onClick={open} style={{ ...cardBase }}>
                <img src={url} alt={a.name} loading="lazy" style={{ display: 'block', height: imgH, maxWidth: 360, width: 'auto', objectFit: 'cover' }} />
              </div>
            );
          }
          if (kind === 'pdf') {
            return (
              <div key={a.path + i} onClick={open} style={{ ...cardBase, position: 'relative', width: compact ? 180 : 240, height: imgH }}>
                <iframe title={a.name} src={`${url}#toolbar=0&navpanes=0&view=FitH`} style={{ width: '100%', height: '100%', border: 'none', background: '#fff', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', inset: 0 }} />
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '4px 8px', background: 'linear-gradient(transparent, rgba(0,0,0,0.6))', color: '#fff', fontSize: 11, fontFamily: 'var(--font-mono)', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span>{KIND_ICON.pdf}</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                </div>
              </div>
            );
          }
          if (kind === 'audio') {
            return (
              <div key={a.path + i} style={{ ...cardBase, cursor: 'default', padding: '8px 10px', minWidth: 240, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>♪ {a.name}</span>
                <audio src={url} controls style={{ width: compact ? 220 : 280, height: 32 }} />
              </div>
            );
          }
          if (kind === 'video') {
            return (
              <div key={a.path + i} onClick={open} style={{ ...cardBase, position: 'relative', width: compact ? 220 : 300, height: imgH, background: '#000' }}>
                <video src={url} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 30, textShadow: '0 2px 8px rgba(0,0,0,0.6)' }}>▶</div>
              </div>
            );
          }
          // text / generic file → compact chip
          return (
            <div key={a.path + i} onClick={open} style={{ ...cardBase, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, minWidth: 180, maxWidth: 280 }}>
              <span style={{ fontSize: 18, color: 'var(--accent)' }}>{KIND_ICON[kind]}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                <div style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{kind} · {humanSize(a.size)}</div>
              </div>
            </div>
          );
        })}
      </div>
      {viewer != null && <AttachmentViewer items={viewerItems} index={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}
