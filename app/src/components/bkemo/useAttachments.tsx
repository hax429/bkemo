import { useCallback, useRef, useState } from 'react';
import {
  uploadAttachment, attachmentUrl, attachmentKind, KIND_ICON,
  type UploadedAttachment,
} from '@/lib/attachments';

/**
 * Composer attachment state: pick (mobile file/photo picker too), drag-drop, and
 * upload-as-you-go. Returns a hidden multiple file input, an `openPicker`, and
 * `dragProps` to spread on the editor container. Pending uploads are passed to
 * `note.upsert` via `items` (see `toUpsertAttachment`).
 */
export function useAttachments() {
  const [items, setItems] = useState<UploadedAttachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (files: FileList | File[] | null) => {
    const arr = Array.from(files ?? []);
    if (arr.length === 0) return;
    setUploading((n) => n + arr.length);
    await Promise.all(arr.map(async (f) => {
      try { const u = await uploadAttachment(f); setItems((p) => [...p, u]); }
      catch (e) { console.error('[attach] upload failed:', e); }
      finally { setUploading((n) => n - 1); }
    }));
  }, []);

  const remove = useCallback((path: string) => setItems((p) => p.filter((x) => x.path !== path)), []);
  const clear = useCallback(() => { setItems([]); setUploading(0); }, []);
  const openPicker = useCallback(() => inputRef.current?.click(), []);

  const dragProps = {
    onDragOver: (e: React.DragEvent) => { if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) { e.preventDefault(); setDragOver(true); } },
    onDragLeave: (e: React.DragEvent) => { if (e.currentTarget === e.target) setDragOver(false); },
    onDrop: (e: React.DragEvent) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); } },
  };

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      multiple
      style={{ display: 'none' }}
      onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = ''; }}
    />
  );

  return { items, uploading, dragOver, addFiles, remove, clear, openPicker, dragProps, fileInput };
}

/** Removable preview chips for pending composer uploads. */
export function PendingAttachments({ items, uploading, onRemove }: {
  items: UploadedAttachment[];
  uploading: number;
  onRemove: (path: string) => void;
}) {
  if (items.length === 0 && uploading === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
      {items.map((a) => {
        const kind = attachmentKind(a.type, a.name);
        return (
          <div key={a.path} className="h-stack" style={{ gap: 8, padding: '5px 8px 5px 5px', border: '1px solid var(--border-2)', borderRadius: 8, background: 'var(--bg)', maxWidth: 220 }}>
            {kind === 'image'
              ? <img src={attachmentUrl(a.path)} alt={a.name} style={{ width: 34, height: 34, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }} />
              : <span style={{ width: 34, height: 34, borderRadius: 5, background: 'var(--bg-3)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', flexShrink: 0 }}>{KIND_ICON[kind]}</span>}
            <span style={{ fontSize: 12, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title={a.name}>{a.name}</span>
            <span onClick={() => onRemove(a.path)} style={{ cursor: 'pointer', color: 'var(--fg-3)', fontSize: 13, flexShrink: 0 }}>✕</span>
          </div>
        );
      })}
      {uploading > 0 && (
        <div className="h-stack" style={{ gap: 6, padding: '5px 10px', border: '1px dashed var(--border-2)', borderRadius: 8, color: 'var(--fg-3)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
          <span className="bk-spin" style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid var(--border-2)', borderTopColor: 'var(--accent)', borderRadius: '50%' }} />
          Uploading {uploading}…
        </div>
      )}
    </div>
  );
}
