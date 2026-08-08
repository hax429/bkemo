import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/trpc';
import { MarkdownOnlyEditor, type MarkdownOnlyEditorHandle } from './MarkdownOnlyEditor';

type Tab = 'link' | 'markdown' | 'archive';

type Enrichment = {
  id: string;
  markdown: string;
  archiveUrl: string;
  markdownStatus: string;
  archiveStatus: string;
  status: string;
  error: string;
};

export function BookmarkExpandOverlay({
  href,
  enrichmentId,
  noteId,
  title,
  onClose,
  onEnrichmentId,
}: {
  href: string;
  enrichmentId: string | null;
  noteId?: number;
  title: string;
  onClose: () => void;
  onEnrichmentId?: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('link');
  const [iframeBlocked, setIframeBlocked] = useState(false);
  const [row, setRow] = useState<Enrichment | null>(null);
  const editorRef = useRef<MarkdownOnlyEditorHandle>(null);
  const [draftMd, setDraftMd] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      try {
        const found = enrichmentId
          ? await api.linkEnrichment.getByUrl.query({ url: href, noteId })
          : await api.linkEnrichment.getByUrl.query({ url: href, noteId });
        if (cancelled) return;
        if (found) {
          setRow(found);
          onEnrichmentId?.(found.id);
          if (found.markdown && !draftMd) setDraftMd(found.markdown);
          if (found.status === 'pending' || found.status === 'running' || found.archiveStatus === 'pending') {
            timer = setTimeout(load, 2500);
          }
        }
      } catch {
        /* not saved yet */
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href, enrichmentId, noteId]);

  const retry = async () => {
    if (!row?.id) return;
    const next = await api.linkEnrichment.retry.mutate({ id: row.id });
    setRow(next);
  };

  const saveMarkdown = async () => {
    if (!row?.id) return;
    const md = editorRef.current?.getMarkdown() ?? draftMd;
    const next = await api.linkEnrichment.saveMarkdown.mutate({ id: row.id, markdown: md });
    setRow(next);
    setDraftMd(next.markdown);
  };

  const insertIntoNote = () => {
    const md = editorRef.current?.getMarkdown() ?? draftMd;
    if (!md) return;
    // Parent editors listen for this bus event if they want to insert.
    window.dispatchEvent(new CustomEvent('bkemo:insert-bookmark-markdown', { detail: { href, markdown: md } }));
  };

  return createPortal(
    <div className="bk-bookmark-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bk-bookmark-overlay-top">
        <div className="bk-bookmark-tabs" role="tablist">
          <TabButton active={tab === 'link'} onClick={() => setTab('link')}>Link</TabButton>
          <TabButton active={tab === 'markdown'} onClick={() => setTab('markdown')}>Markdown</TabButton>
          <TabButton active={tab === 'archive'} onClick={() => setTab('archive')}>Archive</TabButton>
        </div>
        <div className="bk-bookmark-overlay-actions">
          <a className="bk-bookmark-open-ext" href={href} target="_blank" rel="noreferrer">Open original</a>
          <button type="button" className="bk-bookmark-close" onClick={onClose} aria-label="Close">×</button>
        </div>
      </div>

      <div className="bk-bookmark-overlay-body">
        {tab === 'link' && (
          iframeBlocked ? (
            <Fallback
              title="This site blocks in-app embedding"
              actionLabel="Open in browser"
              href={href}
            />
          ) : (
            <iframe
              className="bk-bookmark-frame"
              src={href}
              title={title}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              onError={() => setIframeBlocked(true)}
              onLoad={(e) => {
                try {
                  // Cross-origin access throws — that's fine (page loaded).
                  void (e.currentTarget.contentWindow?.location.href);
                } catch {
                  /* expected for cross-origin */
                }
              }}
            />
          )
        )}

        {tab === 'markdown' && (
          <div className="bk-bookmark-markdown">
            {!row && <StatusLine text="Save the memo to extract Markdown from this page." />}
            {row?.markdownStatus === 'pending' || row?.markdownStatus === 'running' ? (
              <StatusLine text="Extracting Markdown…" />
            ) : null}
            {row?.markdownStatus === 'error' ? (
              <StatusLine text={row.error || 'Markdown extraction failed'} action="Retry" onAction={retry} />
            ) : null}
            {(row?.markdownStatus === 'ready' || draftMd) && (
              <>
                <MarkdownOnlyEditor
                  ref={editorRef}
                  value={draftMd || row?.markdown || ''}
                  onChange={setDraftMd}
                  placeholder="Extracted Markdown…"
                  className="bk-bookmark-md-editor"
                />
                <div className="bk-bookmark-md-actions">
                  <button type="button" onClick={() => void saveMarkdown()} disabled={!row?.id}>Save draft</button>
                  <button type="button" onClick={insertIntoNote}>Insert into note</button>
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'archive' && (
          !row ? (
            <StatusLine text="Save the memo to archive this page on the Internet Archive." />
          ) : row.archiveStatus === 'ready' && row.archiveUrl ? (
            <iframe className="bk-bookmark-frame" src={row.archiveUrl} title={`Archive of ${title}`} />
          ) : row.archiveStatus === 'pending' || row.archiveStatus === 'running' ? (
            <StatusLine text="Creating Wayback snapshot…" />
          ) : (
            <StatusLine text={row.error || 'Archive unavailable'} action="Retry" onAction={retry} />
          )
        )}
      </div>
    </div>,
    document.body,
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={active} className={`bk-bookmark-tab${active ? ' is-active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

function StatusLine({ text, action, onAction, href, actionLabel }: {
  text: string;
  action?: string;
  onAction?: () => void;
  href?: string;
  actionLabel?: string;
}) {
  return (
    <div className="bk-bookmark-status">
      <p>{text}</p>
      {action && onAction ? <button type="button" onClick={onAction}>{action}</button> : null}
      {href ? <a href={href} target="_blank" rel="noreferrer">{actionLabel || 'Open'}</a> : null}
    </div>
  );
}

function Fallback({ title, actionLabel, href }: { title: string; actionLabel: string; href: string }) {
  return <StatusLine text={title} href={href} actionLabel={actionLabel} />;
}
