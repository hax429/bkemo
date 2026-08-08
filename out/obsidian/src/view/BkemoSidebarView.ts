import {
  ItemView,
  MarkdownView,
  Notice,
  WorkspaceLeaf,
  setIcon,
} from 'obsidian';
import type ComoPlugin from '../main';
import { BKEMO_VIEW_TYPE } from '../modeSwitch';
import { readCredential } from '../pairing';
import { logDiagnostic } from '../diagnostics';
import { appendNoteToEditor } from '../vault/append';
import type { BkemoAttachment, BkemoNote, BkemoTag } from '../types';
import { pullChangesBounded } from '../sync/changes';
import { outboxPendingCount } from '../sync/outbox';
import { VoiceRecorder, type RecorderState } from './recorder';
import {
  canEmbedObsidianEditor,
  createEmbeddableMarkdownEditor,
  type EmbeddableMarkdownEditor,
} from './embeddableEditor';
import { renderObsidianMarkdown } from './notePreview';
import {
  ObjectUrlRegistry,
  attachmentKind,
  formatAttachmentSize,
} from './attachmentPreview';
import { buildSearchInput, filtersAreActive } from './searchFilters';
import {
  applyEditorDraft,
  createEditorState,
  editorStatusLabel,
  markEditorConflict,
  markEditorSaved,
  markEditorSaving,
  type SidebarEditorState,
} from './editor';
import { ConflictModal } from './conflictModal';
import { BookmarkDialog, openInObsidianBrowser } from './bookmarkDialog';
import {
  formatNoteTime,
  isTaskNote,
  noteTags,
} from './noteList';
import { renderAttachmentFilenames, renderMemoCard } from './noteCard';
import { normalizeUrl } from '../../../../shared/lib/linkUrls';

export { BKEMO_VIEW_TYPE };
export class BkemoSidebarView extends ItemView {
  private notes: BkemoNote[] = [];
  private selected: BkemoNote | null = null;
  private status = 'Ready';
  private query = '';
  private composeDraft = '';
  private tasksOnly = false;
  private includeArchived = false;
  private selectedTag: string | null = null;
  private availableTags: BkemoTag[] = [];
  /** Credential is stored locally (settings / empty-state). */
  private paired = false;
  /** Last refresh reached bkemo; null = not checked yet. */
  private live: boolean | null = null;
  private capturing = false;
  private searchOpen = false;
  private statsOpen = false;
  private recorder = new VoiceRecorder();
  private recorderState: RecorderState = { status: 'idle' };
  private layoutReady = false;
  private composeEditor: EmbeddableMarkdownEditor | null = null;
  private noteEditor: EmbeddableMarkdownEditor | null = null;
  private noteTextarea: HTMLTextAreaElement | null = null;
  private editState: SidebarEditorState | null = null;
  private ignoreEditorBlur = false;
  private committingEdit = false;
  private editorEpoch = 0;
  private watchEpoch = 0;
  private disposed = false;
  private objectUrls = new ObjectUrlRegistry();
  private overlayUrls = new ObjectUrlRegistry();
  private overlayEl: HTMLElement | null = null;
  private overlayKeyHandler: ((event: KeyboardEvent) => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: ComoPlugin) {
    super(leaf);
  }

  /** Called from plugin onunload — cancel async work and tear down overlays. */
  dispose(): void {
    this.disposed = true;
    this.watchEpoch += 1;
    this.closeAttachmentFullscreen();
    this.destroyComposerEditor();
    this.destroyNoteEditor();
    this.objectUrls.revokeAll();
    this.recorder.discard();
  }

  /** Command palette: open capture dock and clear selection. */
  focusCaptureComposer(): void {
    if (this.disposed) return;
    void this.selectNote(null).then(() => {
      window.setTimeout(() => {
        this.composeEditor?.focus();
        const textarea = this.contentEl.querySelector('.bkemo-composer-input') as HTMLTextAreaElement | null;
        textarea?.focus();
      }, 0);
    });
  }

  getViewType(): string {
    return BKEMO_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.plugin.getLeafDisplayText();
  }

  getIcon(): string {
    return this.plugin.getLeafIconId();
  }

  async onOpen(): Promise<void> {
    this.disposed = false;
    this.paired = !!(await readCredential(this.plugin));
    this.live = null;
    this.notes = this.plugin.notesFromCache();
    if (this.notes.length) this.status = `${this.notes.length} cached`;
    if (this.plugin.selectedPortableId) {
      this.selected = this.notes.find((n) => n.portableId === this.plugin.selectedPortableId) || null;
    }
    this.render();
    this.app.workspace.onLayoutReady(() => {
      if (this.disposed) return;
      this.layoutReady = true;
      void this.refresh();
    });
  }

  async onClose(): Promise<void> {
    this.watchEpoch += 1;
    await this.commitEdit();
    this.closeAttachmentFullscreen();
    this.destroyComposerEditor();
    this.destroyNoteEditor();
    this.objectUrls.revokeAll();
    this.recorder.discard();
    this.contentEl.empty();
  }

  private destroyComposerEditor() {
    if (this.composeEditor) {
      this.composeEditor.destroy();
      this.composeEditor = null;
    }
  }

  private destroyNoteEditor() {
    this.ignoreEditorBlur = true;
    this.editorEpoch += 1;
    if (this.noteEditor) {
      this.noteEditor.destroy();
      this.noteEditor = null;
    }
    this.noteTextarea = null;
    window.setTimeout(() => {
      this.ignoreEditorBlur = false;
    }, 0);
  }

  private readNoteDraft(): string {
    if (this.noteEditor) return this.noteEditor.getValue();
    if (this.noteTextarea) return this.noteTextarea.value;
    return this.editState?.draft || '';
  }

  private patchEditStatus() {
    const el = this.contentEl.querySelector('.bkemo-edit-status');
    if (!el || !this.editState) return;
    el.setText(editorStatusLabel(this.editState.status));
  }

  private async beginEdit(note: BkemoNote): Promise<void> {
    if (this.editState?.portableId === note.portableId) return;
    if (this.editState) await this.commitEdit();

    let fresh = note;
    try {
      fresh = await this.plugin.client.getNote(note.portableId);
      this.plugin.rememberNotes([fresh]);
      this.notes = this.notes.map((item) => (item.portableId === fresh.portableId ? fresh : item));
    } catch (error: any) {
      if (error?.code === 'offline') {
        this.live = false;
        new Notice('Can’t edit while offline');
        this.render();
        return;
      }
      logDiagnostic('get-note-failed', { code: error?.code || 'unknown' });
    }

    this.editState = createEditorState(fresh.portableId, fresh.revision, fresh.content || '');
    this.selected = fresh;
    this.plugin.setSelectedPortableId(fresh.portableId);
    this.plugin.rememberNotes([fresh]);
    this.patchSelectionUi();
    window.setTimeout(() => {
      this.noteEditor?.focus();
      this.noteTextarea?.focus();
    }, 0);
  }

  private exitEdit(renderAfter = true) {
    this.destroyNoteEditor();
    this.editState = null;
    if (renderAfter) this.patchSelectionUi();
  }

  private async commitEdit(): Promise<void> {
    if (!this.editState || this.committingEdit) return;
    const state = this.editState;
    const draft = this.readNoteDraft();
    const nextState = applyEditorDraft(state, draft);
    this.editState = nextState;

    if (!nextState.dirty) {
      this.exitEdit();
      return;
    }

    this.committingEdit = true;
    this.editState = markEditorSaving(nextState);
    this.patchEditStatus();
    try {
      const updated = await this.plugin.client.updateNote({
        portableId: state.portableId,
        expectedRevision: state.expectedRevision,
        content: draft,
        idempotencyKey: `obsidian-edit-${state.portableId}-${crypto.randomUUID()}`,
      });
      this.plugin.rememberNotes([updated]);
      this.notes = this.notes.map((item) => (item.portableId === updated.portableId ? updated : item));
      if (this.selected?.portableId === updated.portableId) this.selected = updated;
      this.editState = markEditorSaved(this.editState, {
        content: updated.content,
        revision: updated.revision,
      });
      this.live = true;
      this.exitEdit();
    } catch (error: any) {
      if (error?.code === 'revision_conflict') {
        await this.handleEditConflict(draft);
        return;
      }
      if (error?.code === 'offline') this.live = false;
      new Notice(error?.message || 'Couldn’t save note');
      this.exitEdit();
    } finally {
      this.committingEdit = false;
    }
  }

  private async handleEditConflict(localDraft: string): Promise<void> {
    if (!this.editState) return;
    const portableId = this.editState.portableId;
    let remote: BkemoNote;
    try {
      remote = await this.plugin.client.getNote(portableId);
    } catch (error: any) {
      new Notice(error?.message || 'Couldn’t load remote note');
      this.exitEdit();
      return;
    }

    this.editState = markEditorConflict(applyEditorDraft(this.editState, localDraft));
    this.patchEditStatus();

    await new Promise<void>((resolve) => {
      const modal = new ConflictModal(this.app, localDraft, remote.content || '', (choice) => {
        if (choice === 'reload') {
          this.plugin.rememberNotes([remote]);
          this.notes = this.notes.map((item) => (item.portableId === remote.portableId ? remote : item));
          if (this.selected?.portableId === remote.portableId) this.selected = remote;
          this.exitEdit();
        } else if (this.editState) {
          this.editState = markEditorConflict(applyEditorDraft(this.editState, localDraft));
          this.patchSelectionUi();
          window.setTimeout(() => {
            this.noteEditor?.focus();
            this.noteTextarea?.focus();
          }, 0);
        }
        resolve();
      });
      modal.open();
    });
  }

  private filterState() {
    return {
      query: this.query,
      selectedTag: this.selectedTag,
      tasksOnly: this.tasksOnly,
      includeArchived: this.includeArchived,
    };
  }

  private setStatus(status: string) {
    this.status = status;
    const el = this.contentEl.querySelector('.bkemo-status-text');
    if (el) el.setText(status);
  }

  private openPluginSettings() {
    const setting = (this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
    if (!setting) {
      new Notice('Open Settings → como to connect');
      return;
    }
    setting.open();
    setting.openTabById(this.plugin.manifest.id);
  }

  private async loadTagsBestEffort(): Promise<void> {
    try {
      this.availableTags = await this.plugin.client.listTags();
    } catch {
      /* tags:read may be missing; filters still work without the chip list */
    }
  }

  private async hydrateChangesBestEffort(): Promise<void> {
    try {
      const next = await pullChangesBounded(this.plugin.client, this.plugin.cache, 3);
      this.plugin.replaceCache(next);
      logDiagnostic('changes', { cursor: next.changeCursor });
    } catch (error: any) {
      // Keep search results; live state already reflects the successful search.
      logDiagnostic('changes-failed', { code: error?.code || 'unknown' });
    }
  }

  async refresh(): Promise<void> {
    if (!this.layoutReady) return;
    if (this.editState) await this.commitEdit();
    this.paired = !!(await readCredential(this.plugin));
    this.setStatus('Loading');
    try {
      const page = await this.plugin.client.search(buildSearchInput(this.filterState()));
      this.notes = page.notes;
      this.plugin.rememberNotes(page.notes);
      if (this.selected) {
        const still = page.notes.find((note) => note.portableId === this.selected?.portableId);
        this.selected = still || null;
      }
      this.paired = true;
      this.live = true;
      this.setStatus(`${page.notes.length} notes`);
      logDiagnostic('search', {
        count: page.notes.length,
        hasQuery: !!this.query,
        tag: this.selectedTag || undefined,
      });
      await this.loadTagsBestEffort();
      await this.hydrateChangesBestEffort();
      const replay = await this.plugin.replayOutbox();
      if (replay.sent) {
        const again = await this.plugin.client.search(buildSearchInput(this.filterState()));
        this.notes = again.notes;
        this.plugin.rememberNotes(again.notes);
        this.setStatus(`${again.notes.length} notes`);
      }
      this.render();
    } catch (error: any) {
      this.paired = !!(await readCredential(this.plugin));
      this.live = false;
      this.setStatus(error?.message || 'Failed to load');
      this.render();
    }
  }

  private async selectNote(note: BkemoNote | null): Promise<void> {
    if (this.disposed) return;
    if (this.editState) await this.commitEdit();
    if (!note) {
      this.selected = null;
      this.plugin.setSelectedPortableId(null);
      this.patchSelectionUi();
      return;
    }
    // Keep selection sticky on the card — clear via dock close, not a second click.
    if (this.selected?.portableId === note.portableId && !this.editState) return;

    this.selected = note;
    this.plugin.setSelectedPortableId(note.portableId);
    this.plugin.rememberNotes([note]);
    this.patchSelectionUi();

    // Hydrate in the background; only refresh the dock if the payload actually changed.
    const portableId = note.portableId;
    try {
      const full = await this.plugin.client.getNote(portableId);
      if (this.disposed || this.selected?.portableId !== portableId || this.editState) return;
      const changed =
        full.revision !== this.selected.revision ||
        full.content !== this.selected.content ||
        (full.attachments?.length || 0) !== (this.selected.attachments?.length || 0);
      this.selected = full;
      this.plugin.setSelectedPortableId(full.portableId);
      this.plugin.rememberNotes([full]);
      this.notes = this.notes.map((item) => (item.portableId === full.portableId ? full : item));
      if (changed) this.patchSelectionUi({ dockOnly: true });
    } catch (error: any) {
      if (error?.code === 'offline') {
        this.live = false;
        this.patchStatusBar();
      }
      logDiagnostic('get-note-failed', { code: error?.code || 'unknown' });
    }
  }

  /** Update active/editing card chrome + bottom dock without re-rendering the feed. */
  private patchSelectionUi(opts: { dockOnly?: boolean } = {}) {
    const main = this.contentEl.querySelector('.bkemo-main');
    if (!main) {
      this.render();
      return;
    }

    if (!opts.dockOnly) {
      for (const card of Array.from(main.querySelectorAll('.bkemo-memo'))) {
        const id = card.getAttribute('data-portable-id');
        card.classList.toggle('is-active', !!this.selected && id === this.selected.portableId);
        card.classList.toggle('is-editing', !!this.editState && id === this.editState.portableId);
      }
    }

    this.readComposeDraft();
    this.destroyComposerEditor();
    this.destroyNoteEditor();
    const oldDock = main.querySelector('.bkemo-dock');
    oldDock?.remove();
    this.renderDock(main as HTMLElement);
  }

  private patchStatusBar() {
    const text = this.contentEl.querySelector('.bkemo-status-text');
    const dot = this.contentEl.querySelector('.bkemo-status-dot');
    if (!text || !dot) return;
    const pending = outboxPendingCount(this.plugin.outbox);
    text.setText(pending ? ` ${this.status} · ${pending} queued` : ` ${this.status}`);
    dot.className = this.statusDotClass();
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
      new Notice('Note captured');
      await this.refresh();
    } catch (error: any) {
      this.capturing = false;
      if (error?.code === 'offline') {
        this.live = false;
        await this.plugin.enqueueTypedCapture(content);
        this.composeDraft = '';
        this.render();
        return;
      }
      new Notice(error?.message || 'Capture failed');
      this.render();
    }
  }

  private render(): void {
    this.readComposeDraft();
    this.destroyComposerEditor();
    this.destroyNoteEditor();
    this.objectUrls.revokeAll();
    // Keep a fullscreen overlay alive across sidebar re-renders.

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
    this.renderStatus(main);
    this.renderFeed(main);
    this.renderDock(main);
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
    const brandTitle = brand.createEl('h4', { cls: 'bkemo-brand-title', text: 'como' });
    this.plugin.attachBkemoModeSwitcher(brandTitle, brand, this.leaf);
    brand.createSpan({
      cls: 'bkemo-brand-kicker',
      text: `Notes · v${this.plugin.manifest.version}`,
    });

    const searchBtn = top.createEl('button', {
      cls: `bkemo-icon-btn${this.searchOpen || filtersAreActive(this.filterState()) ? ' is-active' : ''}`,
      attr: { 'aria-label': 'Search and filters', 'aria-pressed': String(this.searchOpen) },
    });
    setIcon(searchBtn, 'search');
    searchBtn.onclick = () => {
      this.searchOpen = !this.searchOpen;
      this.render();
      if (this.searchOpen) void this.loadTagsBestEffort().then(() => {
        if (this.searchOpen) this.render();
      });
    };

    const refreshBtn = top.createEl('button', { cls: 'bkemo-icon-btn', attr: { 'aria-label': 'Refresh' } });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.onclick = () => void this.refresh();

    const settingsBtn = top.createEl('button', {
      cls: `bkemo-icon-btn${this.paired ? '' : ' is-active'}`,
      attr: { 'aria-label': 'Open como settings' },
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

    if (this.availableTags.length || this.selectedTag) {
      const tagRow = menu.createDiv({ cls: 'bkemo-chip-row bkemo-tag-filter-row' });
      const clear = tagRow.createEl('button', {
        cls: `bkemo-chip${!this.selectedTag ? ' is-active' : ''}`,
        text: 'All tags',
      });
      clear.onclick = () => {
        this.selectedTag = null;
        void this.refresh();
      };

      const tags = this.availableTags.length
        ? this.availableTags
        : this.selectedTag
          ? [{ portableId: this.selectedTag, name: this.selectedTag }]
          : [];
      for (const tag of tags.slice(0, 24)) {
        const chip = tagRow.createEl('button', {
          cls: `bkemo-chip${this.selectedTag === tag.name ? ' is-active' : ''}`,
          text: `#${tag.name}`,
        });
        chip.onclick = () => {
          this.selectedTag = this.selectedTag === tag.name ? null : tag.name;
          void this.refresh();
        };
      }
    }

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
      grid.createDiv({
        cls: `bkemo-heatmap-cell is-l${level}`,
        attr: { title: `${key}: ${count}` },
      });
    }
  }

  /** Bottom dock: capture (default) | selected preview | edit selected note. */
  private renderDock(root: HTMLElement) {
    const dock = root.createDiv({ cls: 'bkemo-dock' });
    if (this.editState) {
      this.renderDockEdit(dock);
      return;
    }
    if (this.selected) {
      this.renderDockPreview(dock);
      return;
    }
    this.renderDockCapture(dock);
  }

  private renderDockCapture(dock: HTMLElement) {
    const card = dock.createDiv({ cls: 'bkemo-dock-panel bkemo-composer-card' });
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

  private renderDockPreview(dock: HTMLElement) {
    if (!this.selected) return;
    const panel = dock.createDiv({ cls: 'bkemo-dock-panel bkemo-dock-preview' });

    const head = panel.createDiv({ cls: 'bkemo-dock-head' });
    head.createSpan({
      cls: 'bkemo-memo-time',
      text: formatNoteTime(this.selected.updatedAt),
    });
    const badges = head.createDiv({ cls: 'bkemo-memo-badges' });
    if (isTaskNote(this.selected)) badges.createSpan({ cls: 'bkemo-badge is-task', text: 'task' });
    if (this.selected.isImportant) badges.createSpan({ cls: 'bkemo-badge is-important', text: 'important' });
    if (this.selected.isUrgent) badges.createSpan({ cls: 'bkemo-badge is-urgent', text: 'urgent' });
    if (this.selected.isArchived) badges.createSpan({ cls: 'bkemo-badge', text: 'archived' });
    const close = head.createEl('button', {
      cls: 'bkemo-icon-btn',
      attr: { 'aria-label': 'Clear selection' },
    });
    setIcon(close, 'x');
    close.onclick = () => void this.selectNote(null);

    // Single content render — no separate title that repeats the first line.
    const body = panel.createDiv({ cls: 'bkemo-dock-body bkemo-detail-body' });
    void renderObsidianMarkdown(
      this.app,
      this.selected.content?.trim() ? this.selected.content : '_Empty note_',
      body,
      this,
    );

    const tags = noteTags(this.selected);
    if (tags.length) {
      const tagRow = panel.createDiv({ cls: 'bkemo-tag-row' });
      for (const tag of tags) {
        tagRow.createSpan({ cls: 'bkemo-tag', text: `#${tag}` });
      }
    }

    this.mountAttachmentFilenames(panel, this.selected.attachments || [], {
      notePortableId: this.selected.portableId,
      allowCopy: true,
    });

    const actions = panel.createDiv({ cls: 'bkemo-actions bkemo-composer-footer' });
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

    const open = actions.createEl('button', { cls: 'bkemo-btn is-ghost', text: 'Open on web' });
    open.onclick = () => {
      if (this.selected?.source) window.open(this.selected.source, '_blank');
    };
  }

  private renderDockEdit(dock: HTMLElement) {
    if (!this.editState) return;
    const panel = dock.createDiv({ cls: 'bkemo-dock-panel bkemo-dock-edit' });

    const head = panel.createDiv({ cls: 'bkemo-dock-head' });
    head.createSpan({ cls: 'bkemo-dock-kicker', text: 'Editing' });
    head.createSpan({
      cls: 'bkemo-edit-status',
      text: editorStatusLabel(this.editState.status),
    });
    const done = head.createEl('button', {
      cls: 'bkemo-btn is-ghost',
      text: 'Done',
      attr: { type: 'button' },
    });
    done.onclick = () => void this.commitEdit();

    this.mountNoteEditor(panel, this.editState);

    const footer = panel.createDiv({ cls: 'bkemo-composer-footer' });
    footer.createSpan({
      cls: 'bkemo-recorder-hint',
      text: 'Blur or Esc saves · revision-guarded',
    });
  }

  private statusDotClass(): string {
    if (this.live === true) return 'bkemo-status-dot is-live';
    if (this.live === false) return 'bkemo-status-dot is-offline';
    return 'bkemo-status-dot';
  }

  private renderStatus(root: HTMLElement) {
    const bar = root.createDiv({ cls: 'bkemo-status-bar' });
    const left = bar.createDiv({ cls: 'bkemo-status-left' });
    left.createSpan({ cls: this.statusDotClass() });
    const pending = outboxPendingCount(this.plugin.outbox);
    const label = pending
      ? ` ${this.status} · ${pending} queued`
      : ` ${this.status}`;
    left.createSpan({
      cls: 'bkemo-status-text',
      text: label,
    });
  }

  private renderFeed(root: HTMLElement) {
    const feed = root.createDiv({ cls: 'bkemo-feed' });
    if (!this.notes.length) {
      const empty = feed.createDiv({ cls: 'bkemo-empty' });
      empty.setText(this.paired ? 'No notes match these filters' : 'Connect in Settings → como, then refresh');
      if (!this.paired) {
        const go = empty.createEl('button', { cls: 'bkemo-btn is-primary', text: 'Open settings' });
        go.style.marginTop = '12px';
        go.onclick = () => this.openPluginSettings();
      }
      return;
    }

    for (const note of this.notes) {
      const editing = this.editState?.portableId === note.portableId;
      renderMemoCard(feed, {
        note,
        selected: this.selected?.portableId === note.portableId,
        editing,
        renderBody: (host, markdown) => {
          void renderObsidianMarkdown(this.app, markdown, host, this).then(() => {
            this.bindBookmarkClicks(host, note);
          });
        },
        renderAttachments: (host, attachments) => {
          this.mountAttachmentFilenames(host, attachments);
        },
        onSelect: (selected) => {
          void this.selectNote(selected);
        },
        onEdit: (selected) => {
          void this.beginEdit(selected);
        },
      });
    }
  }

  private mountNoteEditor(parent: HTMLElement, state: SidebarEditorState) {
    const host = parent.createDiv({ cls: 'bkemo-note-editor' });
    const epoch = ++this.editorEpoch;
    const onBlur = () => {
      if (epoch !== this.editorEpoch || this.ignoreEditorBlur || this.committingEdit) return;
      void this.commitEdit();
    };
    const onEscape = () => {
      if (epoch !== this.editorEpoch) return true;
      void this.commitEdit();
      return true;
    };
    const onChange = (value: string) => {
      if (!this.editState || epoch !== this.editorEpoch) return;
      this.editState = applyEditorDraft(this.editState, value);
      this.patchEditStatus();
    };

    if (canEmbedObsidianEditor(this.app)) {
      try {
        this.noteEditor = createEmbeddableMarkdownEditor(this.app, host, {
          value: state.draft,
          placeholder: 'Edit note…',
          cls: 'bkemo-note-cm',
          onChange,
          onBlur,
          onEscape,
        });
        return;
      } catch {
        /* fallback below */
      }
    }

    const textarea = host.createEl('textarea', {
      cls: 'bkemo-note-textarea',
      attr: { 'aria-label': 'Edit note' },
      value: state.draft,
    });
    this.noteTextarea = textarea;
    textarea.oninput = () => onChange(textarea.value);
    textarea.onblur = () => onBlur();
    textarea.onkeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscape();
      }
    };
  }

  private mountAttachmentFilenames(
    host: HTMLElement,
    attachments: BkemoAttachment[],
    opts: { notePortableId?: string; allowCopy?: boolean } = {},
  ) {
    renderAttachmentFilenames(host, attachments, {
      formatTitle: (attachment) =>
        [attachment.type, formatAttachmentSize(attachment.size)].filter(Boolean).join(' · '),
      onOpen: (attachment) => {
        void this.openAttachmentFullscreen(attachment);
      },
      onCopy: opts.allowCopy && opts.notePortableId
        ? (attachment) => {
            const note = this.selected?.portableId === opts.notePortableId
              ? this.selected
              : this.notes.find((item) => item.portableId === opts.notePortableId);
            if (!note) {
              new Notice('Select the note first');
              return;
            }
            void this.plugin.copyNoteAttachment(note, attachment);
          }
        : undefined,
    });
  }

  private async watchTranscription(portableId: string): Promise<void> {
    const epoch = ++this.watchEpoch;
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise((resolve) => window.setTimeout(resolve, 4000));
      if (this.disposed || epoch !== this.watchEpoch) return;
      try {
        await this.hydrateChangesBestEffort();
        if (this.disposed || epoch !== this.watchEpoch) return;
        const note = await this.plugin.client.getNote(portableId);
        if (this.disposed || epoch !== this.watchEpoch) return;
        this.plugin.rememberNotes([note]);
        this.notes = this.notes.map((item) => (item.portableId === note.portableId ? note : item));
        if (this.selected?.portableId === portableId && !this.editState) this.selected = note;
        if (note.content.trim()) {
          if (!this.editState) this.patchSelectionUi({ dockOnly: true });
          return;
        }
      } catch {
        return;
      }
    }
  }

  private closeAttachmentFullscreen() {
    if (this.overlayKeyHandler) {
      window.removeEventListener('keydown', this.overlayKeyHandler);
      this.overlayKeyHandler = null;
    }
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    this.overlayUrls.revokeAll();
  }

  private async openAttachmentFullscreen(attachment: BkemoAttachment): Promise<void> {
    this.closeAttachmentFullscreen();

    const overlay = document.body.createDiv({ cls: 'bkemo-attach-overlay' });
    this.overlayEl = overlay;
    overlay.createDiv({ cls: 'bkemo-attach-overlay-backdrop' });

    const panel = overlay.createDiv({ cls: 'bkemo-attach-overlay-panel' });
    const head = panel.createDiv({ cls: 'bkemo-attach-overlay-head' });
    head.createDiv({ cls: 'bkemo-attach-overlay-title', text: attachment.name || 'attachment' });
    const closeBtn = head.createEl('button', {
      cls: 'bkemo-icon-btn',
      attr: { type: 'button', 'aria-label': 'Close attachment' },
    });
    setIcon(closeBtn, 'x');

    const stage = panel.createDiv({ cls: 'bkemo-attach-overlay-stage' });
    stage.createSpan({ cls: 'bkemo-attachment-loading', text: 'Loading…' });

    const close = () => this.closeAttachmentFullscreen();
    closeBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    overlay.querySelector('.bkemo-attach-overlay-backdrop')?.addEventListener('click', close);
    this.overlayKeyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', this.overlayKeyHandler);

    try {
      const blob = await this.plugin.client.getAttachmentContent(attachment.portableId);
      if (this.overlayEl !== overlay) return;
      const url = this.overlayUrls.create(blob);
      stage.empty();
      const kind = attachmentKind(attachment);
      if (kind === 'audio') {
        const audio = stage.createEl('audio', {
          cls: 'bkemo-attach-overlay-audio',
          attr: { controls: 'true', autoplay: 'true', preload: 'metadata' },
        });
        audio.src = url;
        return;
      }
      if (kind === 'image') {
        stage.createEl('img', {
          cls: 'bkemo-attach-overlay-image',
          attr: { src: url, alt: attachment.name || 'attachment' },
        });
        return;
      }
      const link = stage.createEl('a', {
        cls: 'bkemo-attach-overlay-link',
        text: 'Download / open file',
        attr: { href: url, download: attachment.name || 'attachment', target: '_blank', rel: 'noopener' },
      });
      void link;
    } catch (error: any) {
      if (this.overlayEl !== overlay) return;
      stage.empty();
      stage.createSpan({
        cls: 'bkemo-attachment-error',
        text: error?.message || 'Could not load attachment',
      });
      if (error?.code === 'offline') {
        this.live = false;
        const dot = this.contentEl.querySelector('.bkemo-status-dot');
        if (dot) dot.className = this.statusDotClass();
      }
    }
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
        const fileName = `obsidian-${Date.now()}.webm`;
        try {
          const attachment = await this.plugin.client.uploadAudio({
            blob: review.blob,
            fileName,
            mimeType: review.mimeType,
            durationSeconds: review.durationSeconds,
            idempotencyKey: `obsidian-audio-${crypto.randomUUID()}`,
          });
          const created = await this.plugin.client.createNote({
            content: '',
            attachmentPortableIds: [attachment.portableId],
            idempotencyKey: `obsidian-voice-note-${crypto.randomUUID()}`,
          });
          this.recorderState = this.recorder.discard();
          new Notice('Voice note uploaded');
          await this.refresh();
          void this.watchTranscription(created.portableId);
        } catch (error: any) {
          if (error?.code === 'offline') {
            this.live = false;
            await this.plugin.enqueueVoiceCapture({
              blob: review.blob,
              fileName,
              mimeType: review.mimeType,
              durationSeconds: review.durationSeconds,
            });
            this.recorderState = this.recorder.discard();
            this.render();
            return;
          }
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

  private bindBookmarkClicks(host: HTMLElement, note: BkemoNote) {
    host.querySelectorAll('a[href]').forEach((anchor) => {
      const el = anchor as HTMLAnchorElement;
      const href = normalizeUrl(el.getAttribute('href') || el.href || '');
      if (!href) return;
      // Only intercept bare http(s) bookmarks — leave Obsidian vault links alone.
      if (!/^https?:\/\//i.test(href)) return;
      el.addClass('bkemo-bookmark-link');
      el.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.openBookmarkDialog(href, note);
      };
    });
  }

  private async openBookmarkDialog(href: string, note: BkemoNote) {
    let title = href;
    let markdown = '';
    let archiveUrl = '';
    try {
      const row = await this.plugin.client.getLinkEnrichment({
        url: href,
        notePortableId: note.portableId,
      });
      title = row.title || title;
      markdown = row.markdown || '';
      archiveUrl = row.archiveUrl || '';
    } catch {
      /* enrichment may not exist yet */
    }

    new BookmarkDialog(this.app, href, title, markdown, archiveUrl, (choice) => {
      if (choice === 'live') {
        openInObsidianBrowser(this.app, href);
        return;
      }
      if (choice === 'archive') {
        if (!archiveUrl) {
          new Notice('Archive not ready yet');
          return;
        }
        openInObsidianBrowser(this.app, archiveUrl);
        return;
      }
      if (choice === 'markdown') {
        if (!markdown) {
          new Notice('Markdown not ready yet');
          return;
        }
        // Re-open dialog focuses markdown preview already shown; open a main leaf note as fallback.
        const leaf = this.app.workspace.getLeaf('tab');
        void leaf.setViewState({ type: 'markdown', active: true }).then(async () => {
          const view = leaf.view;
          if (view instanceof MarkdownView) {
            await view.editor.setValue(`# ${title}\n\nSource: ${href}\n\n${markdown}`);
          } else {
            new Notice('Open Markdown from the dialog preview');
          }
        });
      }
    }).open();
  }
}
