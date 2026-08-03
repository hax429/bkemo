import { Notice, Plugin, MarkdownView } from 'obsidian';
import { BkemoHttpClient } from './bkemoClient';
import { readCredential } from './pairing';
import { BkemoSettingTab, DEFAULT_SETTINGS, type BkemoSettings } from './settings';
import { emptyCache, upsertCachedNotes, type CacheSnapshot } from './sync/cache';
import type { OutboxCapture } from './sync/outbox';
import { BkemoSidebarView, BKEMO_VIEW_TYPE } from './view/BkemoSidebarView';
import { StubProjectionService } from './vault/projection';
import { appendNoteToEditor } from './vault/append';
import type { BkemoNote } from './types';
import { logDiagnostic } from './diagnostics';

type PersistedData = {
  settings?: Partial<BkemoSettings>;
  cache?: CacheSnapshot;
  outbox?: OutboxCapture[];
};

export default class BkemoPlugin extends Plugin {
  settings: BkemoSettings = { ...DEFAULT_SETTINGS };
  client = new BkemoHttpClient(() => readCredential(this));
  projection = new StubProjectionService(DEFAULT_SETTINGS.vaultRoot);
  cache: CacheSnapshot = emptyCache();
  outbox: OutboxCapture[] = [];

  async onload(): Promise<void> {
    await this.loadSettings();
    this.projection = new StubProjectionService(this.settings.vaultRoot);

    this.registerView(BKEMO_VIEW_TYPE, (leaf) => new BkemoSidebarView(leaf, this));
    this.addRibbonIcon('notebook-pen', 'Open bkemo', () => {
      void this.activateView();
    });
    this.addCommand({
      id: 'open-bkemo-sidebar',
      name: 'Open sidebar',
      callback: () => void this.activateView(),
    });
    this.addCommand({
      id: 'append-selected-note',
      name: 'Append selected bkemo note',
      editorCheckCallback: (checking, editor, ctx) => {
        if (!(ctx instanceof MarkdownView)) return false;
        const note = this.cache.notesById[this.cache.recentIds[0] || ''];
        if (!note) return false;
        if (!checking) appendNoteToEditor(note, editor);
        return true;
      },
    });
    this.addSettingTab(new BkemoSettingTab(this.app, this));

    // Network and cache hydration wait for layout readiness inside the view.
    this.app.workspace.onLayoutReady(() => {
      logDiagnostic('layout-ready', { hasCredentialSecret: !!this.settings.credentialSecretName });
    });
  }

  onunload(): void {
    logDiagnostic('unload', { cachedNotes: Object.keys(this.cache.notesById).length });
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(BKEMO_VIEW_TYPE)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) {
        new Notice('Could not open the right sidebar');
        return;
      }
      leaf = right;
      await leaf.setViewState({ type: BKEMO_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  rememberNotes(notes: BkemoNote[]): void {
    this.cache = upsertCachedNotes(this.cache, notes);
    void this.saveData({
      settings: this.settings,
      cache: this.cache,
      outbox: this.outbox,
    } satisfies PersistedData);
  }

  async clearCache(): Promise<void> {
    this.cache = emptyCache();
    this.outbox = [];
    await this.saveData({
      settings: this.settings,
      cache: this.cache,
      outbox: this.outbox,
    } satisfies PersistedData);
    new Notice('Cleared cached bkemo data');
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as PersistedData | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings || {});
    this.cache = data?.cache || emptyCache();
    this.outbox = data?.outbox || [];
  }

  async saveSettings(): Promise<void> {
    this.projection = new StubProjectionService(this.settings.vaultRoot);
    await this.saveData({
      settings: this.settings,
      cache: this.cache,
      outbox: this.outbox,
    } satisfies PersistedData);
  }
}
