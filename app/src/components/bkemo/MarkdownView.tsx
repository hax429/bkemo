import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PrismAsyncLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { renderMemoBody } from './renderMemoBody';
import { NOTE_LINK_HREF_RE } from '@/lib/noteLinks';
import { eventBus } from '@/lib/event';
import { loadPrefs } from '@/lib/bkemoSettings';
import '../TiptapEditor/tiptap.css';

/** Highlight #tags inside text children while leaving inline markdown elements intact. */
function hl(children: React.ReactNode): React.ReactNode {
  return React.Children.toArray(children).map((c, i) =>
    typeof c === 'string' ? <React.Fragment key={i}>{renderMemoBody(c)}</React.Fragment> : c,
  );
}

/**
 * Fenced code block with language syntax highlighting (```python …). Inline code
 * (`x`) and language-less blocks fall back to the plain `.tiptap-content` styles.
 */
function CodeBlock({ className, children, dark }: { className?: string; children?: React.ReactNode; dark: boolean }) {
  const text = String(children ?? '').replace(/\n$/, '');
  const match = /language-([\w-]+)/.exec(className || '');
  const isBlock = !!match || text.includes('\n');
  if (!isBlock) return <code className={className}>{children}</code>;
  const lang = match?.[1];
  return (
    <div className="bk-code-block">
      {lang && <span className="bk-code-lang">{lang}</span>}
      <SyntaxHighlighter
        language={lang || 'text'}
        style={dark ? oneDark : oneLight}
        PreTag="div"
        customStyle={{ margin: 0, padding: '14px 14px', borderRadius: 'var(--radius-lg, 10px)', border: '1px solid var(--border)', fontSize: 13, lineHeight: 1.55 }}
        codeTagProps={{ style: { fontFamily: 'var(--font-mono, ui-monospace, monospace)' } }}
      >
        {text}
      </SyntaxHighlighter>
    </div>
  );
}

/**
 * Read-only Markdown preview for memo cards. Renders GFM (lists, task checkboxes,
 * headings, bold, links, code) with the same typography as the TipTap editor
 * (.tiptap-content) so the stream stays visually consistent with editing, and
 * keeps the accent #tag highlighting from the prototype.
 */
export function MarkdownView({ content }: { content: string }) {
  const dark = loadPrefs().theme !== 'light';
  return (
    <div className="tiptap-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p>{hl(children)}</p>,
          // Code blocks render their own container (highlighter) — pass `pre`
          // through so we don't double-wrap in the default <pre>.
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => <CodeBlock className={className} dark={dark}>{children}</CodeBlock>,
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
