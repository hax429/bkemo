import { Modal } from 'obsidian';

export class ConflictModal extends Modal {
  constructor(
    app: ConstructorParameters<typeof Modal>[0],
    private readonly localDraft: string,
    private readonly remoteContent: string,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Revision conflict' });
    contentEl.createEl('p', { text: 'The note changed in bkemo after this draft was loaded. Version 1 does not force overwrite.' });

    contentEl.createEl('h3', { text: 'Local draft' });
    contentEl.createEl('pre', { text: this.localDraft });

    contentEl.createEl('h3', { text: 'Current bkemo' });
    contentEl.createEl('pre', { text: this.remoteContent });

    const close = contentEl.createEl('button', { text: 'Close' });
    close.onclick = () => this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
