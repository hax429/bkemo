import { MarkdownView, Notice, type PluginSettingTab, type WorkspaceLeaf } from 'obsidian';
import { addIcon } from 'obsidian';
import ClaudianPlugin from './codian/main';
import { BkemoHttpClient } from './bkemoClient';
import { COMO_ICON_ID, COMO_ICON_SVG } from './comoLogo';
import { ComoSettingTab } from './comoSettings';
import { logDiagnostic } from './diagnostics';
import {
  attachModeSwitchChevron,
  attachModeSwitchTarget,
  BKEMO_VIEW_TYPE,
  CODIAN_VIEW_TYPE,
  showModeMenu,
  switchComoMode,
  viewTypeForMode,
  type ComoMode,
  type ComoModeHost,
} from './modeSwitch';
import { readCredential } from './pairing';
import { DEFAULT_SETTINGS, type BkemoSettings } from './settings';
import { clearAudioBlobs, deleteAudioBlob, getAudioBlob, putAudioBlob } from './sync/audioStore';
import { emptyCache, upsertCachedNotes, type CacheSnapshot } from './sync/cache';
import {
  enqueueCapture,
  markCaptureFailure,
  outboxPendingCount,
  removeCapture,
  type OutboxCapture,
} from './sync/outbox';
import type { BkemoAttachment, BkemoNote } from './types';
import { appendNoteToEditor } from './vault/append';
import { copyAttachmentToVault, notifyCopyAttachment } from './vault/attachments';
import { BkemoSidebarView } from './view/BkemoSidebarView';

type PersistedData = {
  settings?: Partial<BkemoSettings>;
  cache?: CacheSnapshot;
  outbox?: OutboxCapture[];
  activeMode?: ComoMode;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export default class ComoPlugin extends ClaudianPlugin implements ComoModeHost {
  bkemoSettings: BkemoSettings = { ...DEFAULT_SETTINGS };
  client = new BkemoHttpClient(() => readCredential(this));
  cache: CacheSnapshot = emptyCache();
  outbox: OutboxCapture[] = [];
  selectedPortableId: string | null = null;
  activeMode: ComoMode = 'bkemo';
  private replayingOutbox = false;
  private bkemoDisposed = false;

  protected createSettingTab(): PluginSettingTab | null {
    return new ComoSettingTab(this.app, this);
  }

  protected getRibbonTooltip(): string {
    return 'Open como';
  }

  protected getRibbonIconId(): string {
    return COMO_ICON_ID;
  }

  protected registerPluginIcons(): void {
    super.registerPluginIcons();
    addIcon(COMO_ICON_ID, COMO_ICON_SVG);
  }

  getLeafIconId(): string {
    return COMO_ICON_ID;
  }

  getLeafDisplayText(): string {
    return 'como';
  }

  getLeafModeKicker(): string {
    return `Chat · v${this.manifest.version}`;
  }

  /** Persist a Chat reply as a Notes memo (online create, offline outbox). */
  async saveChatMarkdownAsNote(markdown: string): Promise<void> {
    const content = markdown.trim();
    if (!content) {
      throw new Error('Nothing to save');
    }
    try {
      const note = await this.client.createNote({
        content,
        idempotencyKey: `obsidian-chat-save-${crypto.randomUUID()}`,
      });
      this.rememberNotes([note]);
      new Notice('Saved as note');
    } catch (error: any) {
      if (error?.code === 'offline' || error?.code === 'unauthorized') {
        await this.enqueueTypedCapture(content);
        return;
      }
      throw error instanceof Error ? error : new Error(error?.message || 'Could not save note');
    }
  }

  protected async onAfterCodianOnload(): Promise<void> {
    this.bkemoDisposed = false;
    await this.loadBkemoData();

    this.registerView(BKEMO_VIEW_TYPE, (leaf) => new BkemoSidebarView(leaf, this));

    this.addCommand({
      id: 'open-como',
      name: 'Open como',
      callback: () => void this.activateModeView(this.activeMode),
    });
    this.addCommand({
      id: 'switch-como-mode',
      name: 'Switch Notes / Chat',
      callback: () => {
        const next: ComoMode = this.activeMode === 'bkemo' ? 'codian' : 'bkemo';
        const leaf = this.findActiveComoLeaf();
        void switchComoMode(this, next, leaf);
      },
    });
    this.addCommand({
      id: 'open-bkemo-list',
      name: 'Open Notes',
      callback: () => void this.activateModeView('bkemo'),
    });
    this.addCommand({
      id: 'create-bkemo-note',
      name: 'Create new note',
      callback: () => void this.openCaptureComposer(),
    });
    this.addCommand({
      id: 'append-selected-note',
      name: 'Append selected note',
      editorCheckCallback: (checking, editor, ctx) => {
        if (!(ctx instanceof MarkdownView)) return false;
        const note = this.getSelectedNote();
        if (!note) return false;
        if (!checking) {
          appendNoteToEditor(note, editor);
          new Notice('Appended to current note');
        }
        return true;
      },
    });
    this.addCommand({
      id: 'copy-selected-markdown',
      name: 'Copy selected note markdown',
      checkCallback: (checking) => {
        const note = this.getSelectedNote();
        if (!note) return false;
        if (!checking) {
          void navigator.clipboard.writeText(note.content).then(() => {
            new Notice('Copied Markdown');
          });
        }
        return true;
      },
    });
    this.addCommand({
      id: 'copy-selected-attachment',
      name: 'Copy attachment from selected note',
      checkCallback: (checking) => {
        const note = this.getSelectedNote();
        const attachments = note?.attachments || [];
        if (!note || !attachments.length) return false;
        if (!checking) void this.copyNoteAttachment(note, attachments[0]!);
        return true;
      },
    });

    this.app.workspace.onLayoutReady(() => {
      if (this.bkemoDisposed) return;
      logDiagnostic('layout-ready', {
        hasCredentialSecret: !!this.bkemoSettings.credentialSecretName,
        outbox: outboxPendingCount(this.outbox),
        activeMode: this.activeMode,
      });
      void this.replayOutbox();
    });
  }

  protected onAfterCodianUnload(): void {
    this.bkemoDisposed = true;
    for (const leaf of this.app.workspace.getLeavesOfType(BKEMO_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof BkemoSidebarView) view.dispose();
    }
    logDiagnostic('unload', { cachedNotes: Object.keys(this.cache.notesById).length });
  }

  onProductTitleDoubleClick(
    event: MouseEvent,
    anchor: HTMLElement,
    leaf?: WorkspaceLeaf,
  ): void {
    showModeMenu(this, event, anchor, leaf ?? this.findActiveComoLeaf());
  }

  attachCodianModeSwitcher(
    titleText: HTMLElement,
    titleRow: HTMLElement,
    leaf: WorkspaceLeaf,
  ): void {
    attachModeSwitchTarget(titleText, this, () => leaf);
    attachModeSwitchChevron(titleRow, this, () => leaf);
  }

  async setActiveMode(mode: ComoMode): Promise<void> {
    this.activeMode = mode;
    await this.persistBkemoData();
  }

  findActiveComoLeaf(): WorkspaceLeaf | null {
    const { workspace } = this.app;
    const active = workspace.activeLeaf;
    if (active) {
      const type = active.view?.getViewType?.();
      if (type === BKEMO_VIEW_TYPE || type === CODIAN_VIEW_TYPE) return active;
    }
    return (
      workspace.getLeavesOfType(viewTypeForMode(this.activeMode))[0]
      ?? workspace.getLeavesOfType(BKEMO_VIEW_TYPE)[0]
      ?? workspace.getLeavesOfType(CODIAN_VIEW_TYPE)[0]
      ?? null
    );
  }

  async activateModeView(mode: ComoMode, preferredLeaf?: WorkspaceLeaf | null): Promise<void> {
    const { workspace } = this.app;
    const viewType = viewTypeForMode(mode);
    let leaf = preferredLeaf ?? null;

    if (leaf) {
      await leaf.setViewState({ type: viewType, active: true });
    } else {
      leaf = workspace.getLeavesOfType(viewType)[0] ?? null;
      if (!leaf) {
        const otherType = mode === 'bkemo' ? CODIAN_VIEW_TYPE : BKEMO_VIEW_TYPE;
        const other = workspace.getLeavesOfType(otherType)[0];
        if (other) {
          leaf = other;
          await leaf.setViewState({ type: viewType, active: true });
        } else {
          const right = workspace.getRightLeaf(false);
          if (!right) {
            new Notice('Could not open the right sidebar');
            return;
          }
          leaf = right;
          await leaf.setViewState({ type: viewType, active: true });
        }
      }
    }

    if (leaf) await workspace.revealLeaf(leaf);
  }

  /** Prefer opening the active como mode (overrides Codian-only activateView callers for ribbon). */
  async activateView(): Promise<void> {
    await this.activateModeView(this.activeMode);
  }

  async activateBkemoView(): Promise<BkemoSidebarView | null> {
    await this.activateModeView('bkemo');
    const leaf = this.app.workspace.getLeavesOfType(BKEMO_VIEW_TYPE)[0];
    return leaf?.view instanceof BkemoSidebarView ? leaf.view : null;
  }

  async openCaptureComposer(): Promise<void> {
    const view = await this.activateBkemoView();
    view?.focusCaptureComposer();
  }

  attachBkemoModeSwitcher(brandTitle: HTMLElement, brandRow: HTMLElement, leaf: WorkspaceLeaf): void {
    attachModeSwitchTarget(brandTitle, this, () => leaf);
    attachModeSwitchChevron(brandRow, this, () => leaf);
  }

  setSelectedPortableId(portableId: string | null): void {
    this.selectedPortableId = portableId;
  }

  getSelectedNote(): BkemoNote | null {
    if (!this.selectedPortableId) return null;
    return this.cache.notesById[this.selectedPortableId] || null;
  }

  async copyNoteAttachment(note: BkemoNote, attachment: BkemoAttachment): Promise<void> {
    try {
      const blob = await this.client.getAttachmentContent(attachment.portableId);
      const result = await copyAttachmentToVault(
        this.app,
        note.portableId,
        attachment,
        blob,
        this.bkemoSettings.vaultRoot,
      );
      notifyCopyAttachment(result);
    } catch (error: any) {
      new Notice(error?.message || 'Could not copy attachment');
    }
  }

  rememberNotes(notes: BkemoNote[]): void {
    this.cache = upsertCachedNotes(this.cache, notes);
    void this.persistBkemoData();
  }

  replaceCache(cache: CacheSnapshot): void {
    this.cache = cache;
    void this.persistBkemoData();
  }

  notesFromCache(): BkemoNote[] {
    return this.cache.recentIds
      .map((id) => this.cache.notesById[id])
      .filter((note): note is BkemoNote => !!note);
  }

  async clearCache(): Promise<void> {
    this.cache = emptyCache();
    this.outbox = [];
    this.selectedPortableId = null;
    await clearAudioBlobs();
    await this.persistBkemoData();
    new Notice('Cleared cached notes');
  }

  async enqueueTypedCapture(content: string): Promise<void> {
    const item: OutboxCapture = {
      kind: 'typed',
      id: crypto.randomUUID(),
      content,
      idempotencyKey: `obsidian-capture-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
      attempts: 0,
    };
    this.outbox = enqueueCapture(this.outbox, item);
    await this.persistBkemoData();
    new Notice('Queued capture offline');
  }

  async enqueueVoiceCapture(input: {
    blob: Blob;
    fileName: string;
    mimeType: string;
    durationSeconds?: number;
  }): Promise<void> {
    const audioKey = `voice-${crypto.randomUUID()}`;
    await putAudioBlob(audioKey, input.blob);
    const item: OutboxCapture = {
      kind: 'voice',
      id: crypto.randomUUID(),
      idempotencyKey: `obsidian-voice-note-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
      attempts: 0,
      audioKey,
      fileName: input.fileName,
      mimeType: input.mimeType,
      durationSeconds: input.durationSeconds,
    };
    this.outbox = enqueueCapture(this.outbox, item);
    await this.persistBkemoData();
    new Notice('Queued voice capture offline');
  }

  async replayOutbox(): Promise<{ sent: number; remaining: number }> {
    if (this.bkemoDisposed || this.replayingOutbox || !this.outbox.length) {
      return { sent: 0, remaining: this.outbox.length };
    }
    this.replayingOutbox = true;
    let sent = 0;
    try {
      for (const item of [...this.outbox]) {
        if (this.bkemoDisposed) break;
        try {
          if (item.kind === 'typed') {
            await this.client.createNote({
              content: item.content,
              idempotencyKey: item.idempotencyKey,
            });
          } else {
            const blob = await getAudioBlob(item.audioKey);
            if (!blob) {
              this.outbox = markCaptureFailure(this.outbox, item.id, 'Missing offline audio blob');
              await this.persistBkemoData();
              continue;
            }
            const attachment = await this.client.uploadAudio({
              blob,
              fileName: item.fileName,
              mimeType: item.mimeType,
              durationSeconds: item.durationSeconds,
              idempotencyKey: `obsidian-audio-${item.id}`,
            });
            await this.client.createNote({
              content: '',
              attachmentPortableIds: [attachment.portableId],
              idempotencyKey: item.idempotencyKey,
            });
            await deleteAudioBlob(item.audioKey);
          }
          this.outbox = removeCapture(this.outbox, item.id);
          sent += 1;
          await this.persistBkemoData();
        } catch (error: any) {
          const code = error?.code;
          this.outbox = markCaptureFailure(this.outbox, item.id, error?.message || 'Replay failed');
          await this.persistBkemoData();
          if (code === 'offline' || code === 'unauthorized') break;
        }
      }
      if (sent) logDiagnostic('outbox-replay', { sent, remaining: this.outbox.length });
      return { sent, remaining: this.outbox.length };
    } finally {
      this.replayingOutbox = false;
    }
  }

  async loadBkemoData(): Promise<void> {
    const data = (await this.loadData()) as PersistedData & { projections?: unknown } | null;
    this.bkemoSettings = Object.assign({}, DEFAULT_SETTINGS, data?.settings || {});
    this.cache = data?.cache || emptyCache();
    this.outbox = data?.outbox || [];
    this.activeMode = data?.activeMode === 'codian' ? 'codian' : 'bkemo';
  }

  async saveBkemoSettings(): Promise<void> {
    await this.persistBkemoData();
  }

  private async persistBkemoData(): Promise<void> {
    const existing = await this.loadData();
    const base = isRecord(existing) ? { ...existing } : {};
    await this.saveData({
      ...base,
      settings: this.bkemoSettings,
      cache: this.cache,
      outbox: this.outbox,
      activeMode: this.activeMode,
    });
  }
}

/** @deprecated Use ComoPlugin — kept for local type aliases during migration. */
export type BkemoPlugin = ComoPlugin;
