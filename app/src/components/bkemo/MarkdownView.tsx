import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { renderMemoBody } from './renderMemoBody';
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
          li: ({ children }) => <li>{hl(children)}</li>,
          h1: ({ children }) => <h1>{hl(children)}</h1>,
          h2: ({ children }) => <h2>{hl(children)}</h2>,
          h3: ({ children }) => <h3>{hl(children)}</h3>,
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
