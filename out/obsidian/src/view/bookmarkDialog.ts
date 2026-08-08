import { Modal, Notice, Setting, MarkdownRenderer, type App } from 'obsidian';

export type BookmarkDialogChoice = 'live' | 'markdown' | 'archive';

/**
 * Obsidian dialog for a bkemo bookmark URL.
 * Live / Archive open in Obsidian's built-in browser on a main-window tab.
 * Markdown renders extracted content in the dialog.
 */
export class BookmarkDialog extends Modal {
  private choice: BookmarkDialogChoice | null = null;

  constructor(
    app: App,
    private readonly href: string,
    private readonly title: string,
    private readonly markdown: string,
    private readonly archiveUrl: string,
    private readonly onChoice: (choice: BookmarkDialogChoice) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('bkemo-bookmark-modal');
    contentEl.createEl('h2', { text: this.title || 'Link' });
    contentEl.createEl('p', {
      cls: 'bkemo-bookmark-url',
      text: this.href,
    });

    const actions = contentEl.createDiv({ cls: 'bkemo-bookmark-actions' });
    new Setting(actions)
      .setName('Open link')
      .setDesc('Open the live page in Obsidian’s browser (main window).')
      .addButton((button) =>
        button.setButtonText('Live').setCta().onClick(() => {
          this.choice = 'live';
          this.close();
        }),
      );

    new Setting(actions)
      .setName('Markdown')
      .setDesc(this.markdown ? 'Show extracted Markdown in this dialog.' : 'No extracted Markdown yet — save the memo first.')
      .addButton((button) =>
        button
          .setButtonText('Markdown')
          .setDisabled(!this.markdown)
          .onClick(() => {
            this.choice = 'markdown';
            this.close();
          }),
      );

    new Setting(actions)
      .setName('Archive')
      .setDesc(this.archiveUrl ? 'Open the Wayback snapshot in Obsidian’s browser.' : 'No archive yet — save the memo first.')
      .addButton((button) =>
        button
          .setButtonText('Archive')
          .setDisabled(!this.archiveUrl)
          .onClick(() => {
            this.choice = 'archive';
            this.close();
          }),
      );

    if (this.markdown) {
      const mdWrap = contentEl.createDiv({ cls: 'bkemo-bookmark-md-preview' });
      mdWrap.createEl('h3', { text: 'Extracted Markdown' });
      const target = mdWrap.createDiv();
      void MarkdownRenderer.render(this.app, this.markdown, target, '', this as unknown as import('obsidian').Component);
    }
  }

  onClose(): void {
    this.contentEl.empty();
    if (this.choice) this.onChoice(this.choice);
  }
}

/** Prefer Obsidian Web Viewer on a main tab; fall back to window.open. */
export function openInObsidianBrowser(app: App, url: string): void {
  try {
    const leaf = app.workspace.getLeaf('tab');
    void leaf.setViewState({
      type: 'webviewer',
      active: true,
      state: { url },
    }).then(() => {
      app.workspace.revealLeaf(leaf);
    }).catch(() => {
      window.open(url, '_blank');
    });
  } catch {
    window.open(url, '_blank');
    new Notice('Opened in browser');
  }
}
