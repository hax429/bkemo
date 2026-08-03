import {
  ItemView,
  MarkdownView,
  Notice,
  WorkspaceLeaf,
  setIcon,
} from 'obsidian';
import type BkemoPlugin from '../main';
import { readCredential } from '../pairing';
import { logDiagnostic } from '../diagnostics';
import { appendNoteToEditor } from '../vault/append';
import type { BkemoNote } from '../types';
import { VoiceRecorder, type RecorderState } from './recorder';
import {
  canEmbedObsidianEditor,
  createEmbeddableMarkdownEditor,
  type EmbeddableMarkdownEditor,
} from './embeddableEditor';
import { renderObsidianMarkdown } from './notePreview';
import {
  cardAccent,
  formatNoteTime,
  isTaskNote,
  noteCardBody,
  noteListTitle,
  noteTags,
} from './noteList';

export const BKEMO_VIEW_TYPE = 'bkemo-sidebar';

export class BkemoSidebarView extends ItemView {
  private notes: BkemoNote[] = [];
  private selected: BkemoNote | null = null;
  private status = 'Ready';
  private query = '';
  private composeDraft = '';
  private tasksOnly = false;
  private includeArchived = false;
  private connected = false;
  private capturing = false;
  private searchOpen = false;
  private statsOpen = false;
  private recorder = new VoiceRecorder();
  private recorderState: RecorderState = { status: 'idle' };
  private layoutReady = false;
  private composeEditor: EmbeddableMarkdownEditor | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: BkemoPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return BKEMO_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'bkemo';
  }

  getIcon(): string {
    return 'notebook-pen';
  }

  async onOpen(): Promise<void> {
    this.connected = !!(await readCredential(this.plugin));
    this.render();
    this.app.workspace.onLayoutReady(() => {
      this.layoutReady = true;
      void this.refresh();
    });
  }

  async onClose(): Promise<void> {
    this.destroyComposerEditor();
    this.recorder.discard();
    this.contentEl.empty();
  }

  private destroyComposerEditor() {
    if (this.composeEditor) {
      this.composeEditor.destroy();
      this.composeEditor = null;
    }
  }

  private setStatus(status: string) {
    this.status = status;
    const el = this.contentEl.querySelector('.bkemo-status-text');
    if (el) el.setText(status);
  }

  private openPluginSettings() {
    const setting = (this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
    if (!setting) {
      new Notice('Open Settings → bkemo to connect');
      return;
    }
    setting.open();
    setting.openTabById(this.plugin.manifest.id);
  }

  async refresh(): Promise<void> {
    if (!this.layoutReady) return;
    this.connected = !!(await readCredential(this.plugin));
    this.setStatus('Loading');
    try {
      const page = await this.plugin.client.search({
        query: this.query || undefined,
        tasksOnly: this.tasksOnly,
        archived: this.includeArchived ? 'include' : 'exclude',
        limit: 50,
      });
      this.notes = page.notes;
      this.plugin.rememberNotes(page.notes);
      if (this.selected) {
        this.selected = page.notes.find((note) => note.portableId === this.selected?.portableId) || null;
      }
      this.connected = true;
      this.setStatus(`${page.notes.length} notes`);
      logDiagnostic('search', { count: page.notes.length, hasQuery: !!this.query });
      this.render();
    } catch (error: any) {
      this.connected = !!(await readCredential(this.plugin));
      this.setStatus(error?.message || 'Failed to load');
      this.render();
    }
  }

  private readComposeDraft(): string {
    if (this.composeEditor) {
      this.composeDraft = this.composeEditor.getValue();
    }
    return this.composeDraft;
  }

  private async captureTyped(): Promise<void> {
    const content = this.readComposeDraft().trim();
    if (!content || this.capturing) return;
    this.capturing = true;
    this.render();
    try {
      await this.plugin.client.createNote({
        content,
        idempotencyKey: `obsidian-capture-${crypto.randomUUID()}`,
      });
      this.composeDraft = '';
      this.capturing = false;
      new Notice('Captured to bkemo');
      await this.refresh();
    } catch (error: any) {
      this.capturing = false;
      new Notice(error?.message || 'Capture failed');
      this.render();
    }
  }

  private render(): void {
    this.readComposeDraft();
    this.destroyComposerEditor();

    const root = this.contentEl;
    root.empty();
    root.addClass('bkemo-sidebar');

    const shell = root.createDiv({ cls: 'bkemo-shell' });
    if (this.statsOpen) {
      this.renderStatsPanel(shell);
    }

    const main = shell.createDiv({ cls: 'bkemo-main' });
    this.renderTopbar(main);
    if (this.searchOpen) this.renderSearchMenu(main);
    this.renderComposer(main);
    this.renderStatus(main);
    this.renderFeed(main);
    if (this.selected) this.renderDetail(main);
  }

  private renderTopbar(root: HTMLElement) {
    const top = root.createDiv({ cls: 'bkemo-topbar' });

    const statsBtn = top.createEl('button', {
      cls: `bkemo-icon-btn${this.statsOpen ? ' is-active' : ''}`,
      attr: { 'aria-label': 'Toggle stats panel', 'aria-pressed': String(this.statsOpen) },
    });
    setIcon(statsBtn, 'panel-left');
    statsBtn.onclick = () => {
      this.statsOpen = !this.statsOpen;
      this.render();
    };

    const brand = top.createDiv({ cls: 'bkemo-brand' });
    brand.createEl('h4', { cls: 'bkemo-brand-title', text: 'bkemo' });
    brand.createSpan({ cls: 'bkemo-brand-kicker', text: 'companion' });

    const searchBtn = top.createEl('button', {
      cls: `bkemo-icon-btn${this.searchOpen || this.query || this.tasksOnly || this.includeArchived ? ' is-active' : ''}`,
      attr: { 'aria-label': 'Search and filters', 'aria-pressed': String(this.searchOpen) },
    });
    setIcon(searchBtn, 'search');
    searchBtn.onclick = () => {
      this.searchOpen = !this.searchOpen;
      this.render();
    };

    const refreshBtn = top.createEl('button', { cls: 'bkemo-icon-btn', attr: { 'aria-label': 'Refresh' } });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.onclick = () => void this.refresh();

    const settingsBtn = top.createEl('button', {
      cls: `bkemo-icon-btn${this.connected ? '' : ' is-active'}`,
      attr: { 'aria-label': 'Open bkemo settings' },
    });
    setIcon(settingsBtn, 'settings');
    settingsBtn.onclick = () => this.openPluginSettings();
  }

  private renderSearchMenu(root: HTMLElement) {
    const menu = root.createDiv({ cls: 'bkemo-search-menu' });
    const search = menu.createEl('input', {
      cls: 'bkemo-sidebar-search',
      attr: { placeholder: 'Search notes', 'aria-label': 'Search notes' },
      value: this.query,
    });
    search.oninput = () => {
      this.query = search.value;
    };
    search.onkeydown = (event) => {
      if (event.key === 'Enter') void this.refresh();
      if (event.key === 'Escape') {
        this.searchOpen = false;
        this.render();
      }
    };

    const chips = menu.createDiv({ cls: 'bkemo-chip-row' });
    const tasks = chips.createEl('button', {
      cls: `bkemo-chip${this.tasksOnly ? ' is-active' : ''}`,
      text: 'Tasks',
    });
    tasks.onclick = () => {
      this.tasksOnly = !this.tasksOnly;
      void this.refresh();
    };

    const archived = chips.createEl('button', {
      cls: `bkemo-chip${this.includeArchived ? ' is-active' : ''}`,
      text: 'Archived',
    });
    archived.onclick = () => {
      this.includeArchived = !this.includeArchived;
      void this.refresh();
    };

    window.setTimeout(() => search.focus(), 0);
  }

  private renderStatsPanel(root: HTMLElement) {
    const panel = root.createDiv({ cls: 'bkemo-stats-panel' });
    const head = panel.createDiv({ cls: 'bkemo-stats-head' });
    head.createEl('h5', { text: 'Stats' });
    const close = head.createEl('button', {
      cls: 'bkemo-icon-btn',
      attr: { 'aria-label': 'Close stats panel' },
    });
    setIcon(close, 'x');
    close.onclick = () => {
      this.statsOpen = false;
      this.render();
    };

    const tasks = this.notes.filter(isTaskNote).length;
    const tagged = this.notes.filter((note) => noteTags(note).length > 0).length;
    const uniqueDays = new Set(
      this.notes
        .map((note) => note.updatedAt.slice(0, 10))
        .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)),
    ).size;

    const metrics = panel.createDiv({ cls: 'bkemo-stats-metrics' });
    const items = [
      { label: 'Notes', value: String(this.notes.length) },
      { label: 'Tasks', value: String(tasks) },
      { label: 'Tagged', value: String(tagged) },
    ];
    for (const item of items) {
      const cell = metrics.createDiv({ cls: 'bkemo-stats-metric' });
      cell.createDiv({ cls: 'bkemo-stats-metric-value', text: item.value });
      cell.createDiv({ cls: 'bkemo-stats-metric-label', text: item.label });
    }

    panel.createDiv({
      cls: 'bkemo-stats-footnote',
      text: uniqueDays ? `${uniqueDays} active day${uniqueDays === 1 ? '' : 's'} in view` : 'No activity in view',
    });

    this.renderHeatmap(panel);
  }

  private renderHeatmap(panel: HTMLElement) {
    const counts = new Map<string, number>();
    for (const note of this.notes) {
      const day = note.updatedAt.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      counts.set(day, (counts.get(day) || 0) + 1);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const grid = panel.createDiv({ cls: 'bkemo-heatmap', attr: { 'aria-label': 'Activity heatmap' } });
    // 12 weeks × 7 days, ending today
    const cells = 12 * 7;
    for (let i = cells - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const key = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('-');
      const count = counts.get(key) || 0;
      const level = count === 0 ? 0 : count < 2 ? 1 : count < 4 ? 2 : 3;
      const cell = grid.createDiv({
        cls: `bkemo-heatmap-cell is-l${level}`,
        attr: { title: `${key}: ${count}` },
      });
      void cell;
    }
  }

  private renderComposer(root: HTMLElement) {
    const card = root.createDiv({ cls: 'bkemo-card bkemo-composer-card' });
    const editorHost = card.createDiv({ cls: 'bkemo-composer-editor' });

    let usedEmbed = false;
    if (canEmbedObsidianEditor(this.app)) {
      try {
        this.composeEditor = createEmbeddableMarkdownEditor(this.app, editorHost, {
          value: this.composeDraft,
          placeholder: 'Write a memo…  Use #tags and markdown',
          cls: 'bkemo-composer-cm',
          onChange: (value) => {
            this.composeDraft = value;
          },
          onModEnter: () => {
            void this.captureTyped();
            return true;
          },
        });
        usedEmbed = true;
      } catch {
        usedEmbed = false;
      }
    }

    if (!usedEmbed) {
      const textarea = editorHost.createEl('textarea', {
        cls: 'bkemo-composer-input',
        attr: {
          rows: '4',
          placeholder: 'Write a memo…  Use #tags and markdown',
          'aria-label': 'Typed capture',
        },
        value: this.composeDraft,
      });
      textarea.oninput = () => {
        this.composeDraft = textarea.value;
      };
      textarea.onkeydown = (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          void this.captureTyped();
        }
      };
    }

    const footer = card.createDiv({ cls: 'bkemo-composer-footer' });
    const tools = footer.createDiv({ cls: 'bkemo-composer-tools' });
    this.renderRecorderControls(tools);

    const captureBtn = footer.createEl('button', {
      cls: 'bkemo-btn is-primary',
      text: this.capturing ? 'Saving…' : 'Capture',
    });
    captureBtn.toggleAttribute('disabled', this.capturing);
    captureBtn.onclick = () => void this.captureTyped();
  }

  private renderStatus(root: HTMLElement) {
    const bar = root.createDiv({ cls: 'bkemo-status-bar' });
    const left = bar.createDiv({ cls: 'bkemo-status-left' });
    left.createSpan({
      cls: `bkemo-status-dot${this.connected ? ' is-live' : ''}`,
    });
    left.createSpan({
      cls: 'bkemo-status-text',
      text: ` ${this.status}`,
    });
  }

  private renderFeed(root: HTMLElement) {
    const feed = root.createDiv({ cls: 'bkemo-feed' });
    if (!this.notes.length) {
      const empty = feed.createDiv({ cls: 'bkemo-empty' });
      empty.setText(this.connected ? 'No notes match these filters' : 'Connect in Settings → bkemo, then refresh');
      if (!this.connected) {
        const go = empty.createEl('button', { cls: 'bkemo-btn is-primary', text: 'Open settings' });
        go.style.marginTop = '12px';
        go.onclick = () => this.openPluginSettings();
      }
      return;
    }

    for (const note of this.notes) {
      const accent = cardAccent(note);
      const card = feed.createDiv({
        cls: `bkemo-memo is-${accent}${this.selected?.portableId === note.portableId ? ' is-active' : ''}`,
        attr: { role: 'button', tabindex: '0' },
      });

      const meta = card.createDiv({ cls: 'bkemo-memo-meta' });
      meta.createSpan({ cls: 'bkemo-memo-time', text: formatNoteTime(note.updatedAt) });
      const badges = meta.createDiv({ cls: 'bkemo-memo-badges' });
      if (isTaskNote(note)) badges.createSpan({ cls: 'bkemo-badge is-task', text: 'task' });
      if (note.isImportant) badges.createSpan({ cls: 'bkemo-badge is-important', text: 'important' });
      if (note.isUrgent) badges.createSpan({ cls: 'bkemo-badge is-urgent', text: 'urgent' });
      if (note.isArchived) badges.createSpan({ cls: 'bkemo-badge', text: 'archived' });

      // Single body render — Obsidian reading-view markdown (not a plain text title).
      const body = card.createDiv({ cls: 'bkemo-memo-body' });
      void renderObsidianMarkdown(this.app, noteCardBody(note), body, this);

      const tags = noteTags(note);
      if (tags.length) {
        const tagRow = card.createDiv({ cls: 'bkemo-tag-row' });
        for (const tag of tags) {
          tagRow.createSpan({ cls: 'bkemo-tag', text: `#${tag}` });
        }
      }

      const select = () => {
        this.selected = this.selected?.portableId === note.portableId ? null : note;
        this.render();
      };
      card.onclick = (event) => {
        const target = event.target as HTMLElement;
        if (target.closest('a')) return;
        select();
      };
      card.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select();
        }
      };
    }
  }

  private renderDetail(root: HTMLElement) {
    if (!this.selected) return;
    const card = root.createDiv({ cls: 'bkemo-card bkemo-detail' });
    const head = card.createDiv({ cls: 'bkemo-detail-head' });
    head.createEl('h5', { text: noteListTitle(this.selected) });
    const close = head.createEl('button', { cls: 'bkemo-icon-btn', attr: { 'aria-label': 'Close detail' } });
    setIcon(close, 'x');
    close.onclick = () => {
      this.selected = null;
      this.render();
    };

    const body = card.createDiv({ cls: 'bkemo-detail-body' });
    void renderObsidianMarkdown(
      this.app,
      this.selected.content || '_Empty note_',
      body,
      this,
    );

    const actions = card.createDiv({ cls: 'bkemo-actions' });
    const copy = actions.createEl('button', { cls: 'bkemo-btn', text: 'Copy Markdown' });
    copy.onclick = async () => {
      await navigator.clipboard.writeText(this.selected!.content);
      new Notice('Copied Markdown');
    };

    const append = actions.createEl('button', { cls: 'bkemo-btn', text: 'Append' });
    append.onclick = () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view?.editor || !this.selected) {
        new Notice('Open an editable Markdown note first');
        return;
      }
      appendNoteToEditor(this.selected, view.editor);
      new Notice('Appended to current note');
    };

    const open = actions.createEl('button', { cls: 'bkemo-btn is-ghost', text: 'Open in bkemo' });
    open.onclick = () => {
      if (this.selected?.source) window.open(this.selected.source, '_blank');
    };
  }

  private renderRecorderControls(row: HTMLElement) {
    if (this.recorderState.status === 'idle' || this.recorderState.status === 'unsupported' || this.recorderState.status === 'denied') {
      const start = row.createEl('button', {
        cls: 'bkemo-icon-btn',
        attr: { 'aria-label': 'Record voice note' },
      });
      setIcon(start, 'mic');
      start.onclick = async () => {
        this.recorderState = await this.recorder.start();
        if (this.recorderState.status === 'unsupported' || this.recorderState.status === 'denied') {
          new Notice(this.recorderState.message);
        }
        this.render();
      };
      if (this.recorderState.status !== 'idle') {
        row.createSpan({ cls: 'bkemo-recorder-hint', text: this.recorderState.message });
      }
      return;
    }

    if (this.recorderState.status === 'recording') {
      const stop = row.createEl('button', {
        cls: 'bkemo-icon-btn is-active',
        attr: { 'aria-label': 'Stop recording' },
      });
      setIcon(stop, 'square');
      stop.onclick = async () => {
        this.recorderState = await this.recorder.stop();
        this.render();
      };
      row.createSpan({ cls: 'bkemo-recorder-hint', text: 'Recording…' });
      return;
    }

    if (this.recorderState.status === 'review') {
      const review = this.recorderState;
      const submit = row.createEl('button', { cls: 'bkemo-btn is-primary', text: 'Send audio' });
      submit.onclick = async () => {
        try {
          const attachment = await this.plugin.client.uploadAudio({
            blob: review.blob,
            fileName: `obsidian-${Date.now()}.webm`,
            mimeType: review.mimeType,
            durationSeconds: review.durationSeconds,
            idempotencyKey: `obsidian-audio-${crypto.randomUUID()}`,
          });
          await this.plugin.client.createNote({
            content: '',
            attachmentPortableIds: [attachment.portableId],
            idempotencyKey: `obsidian-voice-note-${crypto.randomUUID()}`,
          });
          this.recorderState = this.recorder.discard();
          new Notice('Voice note uploaded');
          await this.refresh();
        } catch (error: any) {
          new Notice(error?.message || 'Upload failed');
        }
      };
      const discard = row.createEl('button', { cls: 'bkemo-btn is-ghost', text: 'Discard' });
      discard.onclick = () => {
        this.recorderState = this.recorder.discard();
        this.render();
      };
      row.createSpan({ cls: 'bkemo-recorder-hint', text: `${review.durationSeconds}s ready` });
    }
  }
}
