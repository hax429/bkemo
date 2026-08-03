import { App, Notice, PluginSettingTab, SecretComponent, Setting } from 'obsidian';
import type BkemoPlugin from './main';
import { clearCredential, pairWithCredential, readCredential } from './pairing';

export const BKEMO_SECRET_NAME = 'bkemo-device-credential';

export interface BkemoSettings {
  /** SecretStorage name only — never the raw credential. */
  credentialSecretName: string;
  vaultRoot: string;
  pairedDeviceLabel: string;
}

export const DEFAULT_SETTINGS: BkemoSettings = {
  credentialSecretName: BKEMO_SECRET_NAME,
  vaultRoot: 'bkemo',
  pairedDeviceLabel: '',
};

export class BkemoSettingTab extends PluginSettingTab {
  plugin: BkemoPlugin;

  constructor(app: App, plugin: BkemoPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'bkemo' });
    containerEl.createEl('p', {
      text: 'Connect the sidebar here. Paste a scoped access token from bkemo Settings → Security, or a one-time pairing code. Credentials stay in Obsidian SecretStorage.',
    });

    const status = this.plugin.settings.pairedDeviceLabel
      ? `Connected (${this.plugin.settings.pairedDeviceLabel})`
      : 'Not connected';
    containerEl.createEl('p', { text: status });

    containerEl.createEl('h3', { text: 'Connection' });
    containerEl.createEl('p', {
      text: 'Recommended scopes: notes:read, notes:write, tags:read, attachments:read, attachments:write. Create the token on the same bkemo instance the plugin targets.',
    });

    let pendingCredential = '';
    new Setting(containerEl)
      .setName('Access token or pairing code')
      .setDesc('JWT access token, or XXXX-XXXX pairing code')
      .addTextArea((area) => {
        area.setPlaceholder('eyJhbGciOi… or ABCD-EFGH');
        area.inputEl.rows = 4;
        area.inputEl.style.width = '100%';
        area.inputEl.style.fontFamily = 'var(--font-monospace)';
        area.onChange((value) => {
          pendingCredential = value;
        });
      });

    new Setting(containerEl)
      .setName('Connect')
      .setDesc('Validates the credential and stores it in SecretStorage')
      .addButton((button) =>
        button.setButtonText('Connect').setCta().onClick(async () => {
          if (await pairWithCredential(this.plugin, pendingCredential)) {
            pendingCredential = '';
            this.display();
          }
        }),
      )
      .addButton((button) =>
        button.setButtonText('Test session').onClick(async () => {
          const token = await readCredential(this.plugin);
          if (!token) {
            new Notice('No credential stored yet');
            return;
          }
          try {
            const session = await this.plugin.client.session();
            new Notice(`Session ok · ${session.accountName}`);
          } catch (error: any) {
            new Notice(error?.message || 'Session check failed');
          }
        }),
      );

    new Setting(containerEl)
      .setName('Disconnect')
      .setDesc('Clears the local SecretStorage credential. Revoke the token in bkemo to invalidate it server-side.')
      .addButton((button) =>
        button.setButtonText('Disconnect').setWarning().onClick(async () => {
          await clearCredential(this.plugin);
          new Notice('Disconnected from bkemo');
          this.display();
        }),
      );

    containerEl.createEl('h3', { text: 'Storage' });

    new Setting(containerEl)
      .setName('Credential secret')
      .setDesc('SecretStorage entry used for authenticated requests')
      .addComponent((el) =>
        new SecretComponent(this.app, el)
          .setValue(this.plugin.settings.credentialSecretName)
          .onChange(async (value) => {
            this.plugin.settings.credentialSecretName = value || BKEMO_SECRET_NAME;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Vault projection root')
      .setDesc('Save to vault writes under this folder inside the vault')
      .addText((text) =>
        text
          .setPlaceholder('bkemo')
          .setValue(this.plugin.settings.vaultRoot)
          .onChange(async (value) => {
            this.plugin.settings.vaultRoot = value.trim() || 'bkemo';
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Clear cached bkemo data')
      .setDesc('Removes the local note cache. Does not revoke the credential in bkemo.')
      .addButton((button) =>
        button.setButtonText('Clear cache').onClick(async () => {
          await this.plugin.clearCache();
        }),
      );
  }
}
