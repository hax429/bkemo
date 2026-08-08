import { Modal, Setting } from 'obsidian';

export type ConflictModalChoice = 'reload' | 'keep';

export class ConflictModal extends Modal {
  private choice: ConflictModalChoice | null = null;

  constructor(
    app: ConstructorParameters<typeof Modal>[0],
    private readonly localDraft: string,
    private readonly remoteContent: string,
    private readonly onChoice: (choice: ConflictModalChoice) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('bkemo-conflict-modal');
    contentEl.createEl('h2', { text: 'Revision conflict' });
    contentEl.createEl('p', {
      text: 'The note changed on the server after this draft was loaded. Version 1 does not force overwrite.',
    });

    const grid = contentEl.createDiv({ cls: 'bkemo-conflict-grid' });
    const local = grid.createDiv({ cls: 'bkemo-conflict-col' });
    local.createEl('h3', { text: 'Local draft' });
    local.createEl('pre', { cls: 'bkemo-conflict-pre', text: this.localDraft || '(empty)' });

    const remote = grid.createDiv({ cls: 'bkemo-conflict-col' });
    remote.createEl('h3', { text: 'Server version' });
    remote.createEl('pre', { cls: 'bkemo-conflict-pre', text: this.remoteContent || '(empty)' });

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText('Reload remote').onClick(() => {
          this.choice = 'reload';
          this.close();
        }),
      )
      .addButton((button) =>
        button.setButtonText('Keep editing').setCta().onClick(() => {
          this.choice = 'keep';
          this.close();
        }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
    if (this.choice) this.onChoice(this.choice);
  }
}
