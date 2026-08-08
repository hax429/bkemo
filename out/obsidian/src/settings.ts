import { Notice, SecretComponent, Setting, type App } from 'obsidian';
import type { BkemoHttpClient } from './bkemoClient';
import { clearCredential, pairWithCredential, readCredential } from './pairing';
import type { CacheSnapshot } from './sync/cache';
import type { OutboxCapture } from './sync/outbox';
import type { BkemoAttachment, BkemoNote } from './types';

export const BKEMO_SECRET_NAME = 'bkemo-device-credential';

export interface BkemoSettings {
  /** SecretStorage name only — never the raw credential. */
  credentialSecretName: string;
  /** Vault folder root for explicit Copy attachment writes. */
  vaultRoot: string;
  pairedDeviceLabel: string;
}

export const DEFAULT_SETTINGS: BkemoSettings = {
  credentialSecretName: BKEMO_SECRET_NAME,
  vaultRoot: 'bkemo',
  pairedDeviceLabel: '',
};

/** Surface used by bkemo UI / pairing without depending on the concrete plugin class. */
export interface BkemoHost {
  app: App;
  manifest: { id: string; version: string };
  bkemoSettings: BkemoSettings;
  client: BkemoHttpClient;
  cache: CacheSnapshot;
  outbox: OutboxCapture[];
  selectedPortableId: string | null;
  saveBkemoSettings(): Promise<void>;
  clearCache(): Promise<void>;
  rememberNotes(notes: BkemoNote[]): void;
  replaceCache(cache: CacheSnapshot): void;
  notesFromCache(): BkemoNote[];
  setSelectedPortableId(portableId: string | null): void;
  getSelectedNote(): BkemoNote | null;
  replayOutbox(): Promise<{ sent: number; remaining: number }>;
  enqueueTypedCapture(content: string): Promise<void>;
  enqueueVoiceCapture(input: {
    blob: Blob;
    fileName: string;
    mimeType: string;
    durationSeconds?: number;
  }): Promise<void>;
  copyNoteAttachment(note: BkemoNote, attachment: BkemoAttachment): Promise<void>;
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

/** Notes/connection settings — same Setting/heading rhythm as Chat + Providers. */
export function renderBkemoSettings(
  containerEl: HTMLElement,
  plugin: BkemoHost,
  options: { onRefresh?: () => void; app: App } = { app: plugin.app },
): void {
  const refresh = options.onRefresh ?? (() => undefined);
  const app = options.app;
  const connected = !!plugin.bkemoSettings.pairedDeviceLabel;

  new Setting(containerEl).setName('Connection').setHeading();

  new Setting(containerEl)
    .setName('Status')
    .setDesc(
      connected
        ? `Connected as ${plugin.bkemoSettings.pairedDeviceLabel}. Security alerts: revoke or dismiss in the bkemo Mac/Web app → Settings → Security.`
        : 'Not connected. Create a platform-bound Obsidian access token in the bkemo Mac/Web app → Settings → Security. Pairing codes are retired.',
    );

  let pendingCredential = '';
  new Setting(containerEl)
    .setName('Access token')
    .setDesc('Platform-bound JWT. Recommended scopes: notes:read, notes:write, tags:read, attachments:read, attachments:write.')
    .addTextArea((area) => {
      area.setPlaceholder('eyJhbGciOi…');
      area.inputEl.rows = 3;
      area.inputEl.addClass('como-settings-token-input');
      area.onChange((value) => {
        pendingCredential = value;
      });
    });

  new Setting(containerEl)
    .setName('Session')
    .setDesc('Validate and store the token in Obsidian SecretStorage, or clear only the local credential.')
    .addButton((button) =>
      button.setButtonText('Connect').setCta().onClick(async () => {
        if (await pairWithCredential(plugin, pendingCredential)) {
          pendingCredential = '';
          refresh();
        }
      }),
    )
    .addButton((button) =>
      button.setButtonText('Test session').onClick(async () => {
        const token = await readCredential(plugin);
        if (!token) {
          new Notice('No credential stored yet');
          return;
        }
        try {
          const session = await plugin.client.session();
          new Notice(`Session ok · ${session.accountName}`);
        } catch (error: any) {
          new Notice(error?.message || 'Session check failed');
        }
      }),
    )
    .addButton((button) =>
      button.setButtonText('Disconnect').setWarning().onClick(async () => {
        await clearCredential(plugin);
        new Notice('Local credential cleared — revoke in the bkemo Mac/Web app if needed');
        refresh();
      }),
    );

  new Setting(containerEl).setName('Storage').setHeading();

  new Setting(containerEl)
    .setName('Credential secret')
    .setDesc('SecretStorage entry used for authenticated companion requests.')
    .addComponent((el) =>
      new SecretComponent(app, el)
        .setValue(plugin.bkemoSettings.credentialSecretName)
        .onChange(async (value) => {
          plugin.bkemoSettings.credentialSecretName = value || BKEMO_SECRET_NAME;
          await plugin.saveBkemoSettings();
        }),
    );

  new Setting(containerEl)
    .setName('Attachment folder')
    .setDesc('Copy attachment writes under <folder>/attachments/<note-id>/…')
    .addText((text) =>
      text
        .setPlaceholder('bkemo')
        .setValue(plugin.bkemoSettings.vaultRoot)
        .onChange(async (value) => {
          plugin.bkemoSettings.vaultRoot = (value || 'bkemo').replace(/^\/+|\/+$/g, '') || 'bkemo';
          await plugin.saveBkemoSettings();
        }),
    );

  new Setting(containerEl)
    .setName('Clear cached notes')
    .setDesc(
      'Removes local note cache, offline outbox, and IndexedDB audio. Does not revoke the server token. Disabling the plugin without clearing leaves audio blobs until this runs.',
    )
    .addButton((button) =>
      button.setButtonText('Clear cache').onClick(async () => {
        await plugin.clearCache();
      }),
    );
}
