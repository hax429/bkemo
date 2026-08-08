import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/trpc';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';
import { BookmarkExpandOverlay } from './BookmarkExpandOverlay';

type Preview = {
  title: string;
  description: string;
  favicon: string;
  image: string;
};

function resolveImage(src: string): string {
  if (!src) return '';
  if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) return src;
  const token = RootStore.Get(UserStore).tokenData.value?.token;
  const path = token ? `${src}${src.includes('?') ? '&' : '?'}token=${token}` : src;
  return getBlinkoEndpoint(path);
}

export function BookmarkCardView({ node, updateAttributes, selected }: NodeViewProps) {
  const href = String(node.attrs.href || '');
  const noteId = node.attrs.noteId ? Number(node.attrs.noteId) : undefined;
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview>({
    title: node.attrs.title || '',
    description: node.attrs.description || '',
    favicon: node.attrs.favicon || '',
    image: node.attrs.image || '',
  });
  const [enrichmentId, setEnrichmentId] = useState<string | null>(null);

  useEffect(() => {
    if (!href) return;
    let cancelled = false;
    (async () => {
      try {
        const meta = await api.public.linkPreview.query({ url: href });
        if (cancelled || !meta) return;
        const next = {
          title: meta.title || preview.title || hostname(href),
          description: meta.description || preview.description,
          favicon: meta.favicon || preview.favicon,
          image: meta.image || preview.image,
        };
        setPreview(next);
        updateAttributes(next);
      } catch {
        /* ignore preview failures */
      }
      try {
        const row = await api.linkEnrichment.getByUrl.query({ url: href, noteId });
        if (cancelled || !row) return;
        setEnrichmentId(row.id);
        const next = {
          title: row.title || preview.title || hostname(href),
          description: row.description || preview.description,
          favicon: row.favicon || preview.favicon,
          image: row.imagePath || row.imageUrl || preview.image,
        };
        setPreview(next);
        updateAttributes(next);
      } catch {
        /* enrichment may not exist yet */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href, noteId]);

  const domain = hostname(href);
  const imageSrc = resolveImage(preview.image);

  return (
    <NodeViewWrapper className={`bk-bookmark-wrap${selected ? ' is-selected' : ''}`} as="div">
      <button
        type="button"
        className="bk-bookmark-card"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <div className="bk-bookmark-body">
          <div className="bk-bookmark-title">{preview.title || domain || href}</div>
          {preview.description ? <div className="bk-bookmark-desc">{preview.description}</div> : null}
          <div className="bk-bookmark-meta">
            {preview.favicon ? <img className="bk-bookmark-favicon" src={preview.favicon} alt="" /> : null}
            <span>{domain}</span>
          </div>
        </div>
        {imageSrc ? (
          <div className="bk-bookmark-thumb" style={{ backgroundImage: `url("${imageSrc.replace(/"/g, '\\"')}")` }} />
        ) : null}
      </button>
      {open ? (
        <BookmarkExpandOverlay
          href={href}
          enrichmentId={enrichmentId}
          noteId={noteId}
          title={preview.title || domain}
          onClose={() => setOpen(false)}
          onEnrichmentId={setEnrichmentId}
        />
      ) : null}
    </NodeViewWrapper>
  );
}

function hostname(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return href;
  }
}

/** Read-only card used by MarkdownView (stream). */
export function BookmarkCardReadonly({
  href,
  noteId,
}: {
  href: string;
  noteId?: number;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview>({
    title: '',
    description: '',
    favicon: '',
    image: '',
  });
  const [enrichmentId, setEnrichmentId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meta = await api.public.linkPreview.query({ url: href });
        if (!cancelled && meta) {
          setPreview({
            title: meta.title || hostname(href),
            description: meta.description || '',
            favicon: meta.favicon || '',
            image: meta.image || '',
          });
        }
      } catch { /* ignore */ }
      try {
        const row = await api.linkEnrichment.getByUrl.query({ url: href, noteId });
        if (!cancelled && row) {
          setEnrichmentId(row.id);
          setPreview((p) => ({
            title: row.title || p.title || hostname(href),
            description: row.description || p.description,
            favicon: row.favicon || p.favicon,
            image: row.imagePath || row.imageUrl || p.image,
          }));
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [href, noteId]);

  const domain = hostname(href);
  const imageSrc = resolveImage(preview.image);

  return (
    <>
      <button
        type="button"
        className="bk-bookmark-card"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <div className="bk-bookmark-body">
          <div className="bk-bookmark-title">{preview.title || domain || href}</div>
          {preview.description ? <div className="bk-bookmark-desc">{preview.description}</div> : null}
          <div className="bk-bookmark-meta">
            {preview.favicon ? <img className="bk-bookmark-favicon" src={preview.favicon} alt="" /> : null}
            <span>{domain}</span>
          </div>
        </div>
        {imageSrc ? (
          <div className="bk-bookmark-thumb" style={{ backgroundImage: `url("${imageSrc.replace(/"/g, '\\"')}")` }} />
        ) : null}
      </button>
      {open ? (
        <BookmarkExpandOverlay
          href={href}
          enrichmentId={enrichmentId}
          noteId={noteId}
          title={preview.title || domain}
          onClose={() => setOpen(false)}
          onEnrichmentId={setEnrichmentId}
        />
      ) : null}
    </>
  );
}
