import React from 'react';

/** Strip markdown lightly for a VS Code–style plain text view with line numbers. */
export function plainLinesFromMarkdown(content: string): string[] {
  const text = (content ?? '')
    .replace(/^```[\w-]*\n?/gm, '')
    .replace(/^```$/gm, '')
    .replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  // Keep at least one blank line so the editor chrome doesn't collapse.
  return lines.length ? lines : [''];
}

export function VsCodeBody({
  content,
  filename = 'note.md',
  language = 'markdown',
}: {
  content: string;
  filename?: string;
  language?: string;
}) {
  const lines = plainLinesFromMarkdown(content);
  const pad = Math.max(2, String(lines.length).length);

  return (
    <div className="bk-share-vscode">
      <div className="bk-share-vscode-titlebar">
        <div className="bk-share-code-chrome">
          <span className="bk-share-code-dot" />
          <span className="bk-share-code-dot" />
          <span className="bk-share-code-dot" />
        </div>
        <div className="bk-share-vscode-tabs">
          <span className="bk-share-vscode-tab is-active">
            <span className="bk-share-vscode-tab-dot" />
            {filename}
            <span className="bk-share-vscode-tab-x">×</span>
          </span>
        </div>
      </div>
      <div className="bk-share-vscode-editor">
        <div className="bk-share-vscode-gutter" aria-hidden>
          {lines.map((_, i) => (
            <div key={i} className="bk-share-vscode-ln">{String(i + 1).padStart(pad, ' ')}</div>
          ))}
        </div>
        <pre className="bk-share-vscode-code"><code>{lines.map((line, i) => (
          <React.Fragment key={i}>{line || ' '}{i < lines.length - 1 ? '\n' : ''}</React.Fragment>
        ))}</code></pre>
      </div>
      <div className="bk-share-vscode-statusbar">
        <span>Ln {lines.length}, Col 1</span>
        <span>Spaces: 2</span>
        <span>UTF-8</span>
        <span>{language}</span>
      </div>
    </div>
  );
}
