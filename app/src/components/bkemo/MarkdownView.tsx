import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { renderMemoBody } from './renderMemoBody';
import { NOTE_LINK_HREF_RE } from '@/lib/noteLinks';
import { eventBus } from '@/lib/event';
import '../TiptapEditor/tiptap.css';

/** Highlight #tags inside text children while leaving inline markdown elements intact. */
function hl(children: React.ReactNode): React.ReactNode {
  return React.Children.toArray(children).map((c, i) =>
    typeof c === 'string' ? <React.Fragment key={i}>{renderMemoBody(c)}</React.Fragment> : c,
  );
}

/**
 * Read-only Markdown preview for memo cards. Renders GFM (lists, task checkboxes,
 * headings, bold, links, code) with the same typography as the TipTap editor
 * (.tiptap-content) so the stream stays visually consistent with editing, and
 * keeps the accent #tag highlighting from the prototype.
 */
export function MarkdownView({ content }: { content: string }) {
  return (
    <div className="tiptap-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p>{hl(children)}</p>,
          // Keep GFM's `contains-task-list` / `task-list-item` classes so task
          // checkboxes render without a duplicate list bullet (see tiptap.css).
          ul: ({ node, children, ...props }) => <ul {...props}>{children}</ul>,
          li: ({ node, children, ...props }) => <li {...props}>{hl(children)}</li>,
          h1: ({ children }) => <h1>{hl(children)}</h1>,
          h2: ({ children }) => <h2>{hl(children)}</h2>,
          h3: ({ children }) => <h3>{hl(children)}</h3>,
          a: ({ href, children }) => {
            const m = typeof href === 'string' ? href.match(NOTE_LINK_HREF_RE) : null;
            if (m) {
              const id = Number(m[1]);
              // Internal memo link: open the target memo instead of navigating.
              return (
                <a
                  className="bk-note-link"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); eventBus.emit('bkemo:open-note', { id }); }}
                >
                  {children}
                </a>
              );
            }
            return <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{children}</a>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
