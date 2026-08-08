import { setIcon, type App } from 'obsidian';
import { ProviderRegistry } from './codian/core/providers/ProviderRegistry';
import {
  ClaudianSettingTab,
  getOrderedProviderIds,
} from './codian/features/settings/ClaudianSettings';
import type ComoPlugin from './main';
import { renderBkemoSettings } from './settings';

/** Unified como settings surface — Notes + Chat + Providers only. */
type ComoSettingsTabId = 'notes' | 'chat' | 'providers';

const TAB_META: Record<ComoSettingsTabId, { label: string; icon: string }> = {
  notes: { label: 'Notes', icon: 'notebook-pen' },
  chat: { label: 'Chat', icon: 'message-square' },
  providers: { label: 'Providers', icon: 'boxes' },
};

const TAB_IDS: readonly ComoSettingsTabId[] = ['notes', 'chat', 'providers'];

export class ComoSettingTab extends ClaudianSettingTab {
  declare plugin: ComoPlugin;
  private comoActiveTab: ComoSettingsTabId = 'notes';

  constructor(app: App, plugin: ComoPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const displayGeneration = this.beginDisplay();
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('claudian-settings');
    containerEl.addClass('como-settings');

    const registeredProviderIds = getOrderedProviderIds(ProviderRegistry.getRegisteredProviderIds());
    if (!TAB_IDS.includes(this.comoActiveTab)) {
      this.comoActiveTab = 'notes';
    }

    const tabBar = containerEl.createDiv({ cls: 'como-settings-tabs' });
    tabBar.setAttribute('role', 'tablist');

    for (const id of TAB_IDS) {
      const meta = TAB_META[id];
      const button = tabBar.createEl('button', {
        cls: `como-settings-tab${id === this.comoActiveTab ? ' como-settings-tab--active' : ''}`,
        attr: {
          role: 'tab',
          'aria-selected': String(id === this.comoActiveTab),
          type: 'button',
        },
      });
      const icon = button.createSpan({ cls: 'como-settings-tab-icon' });
      setIcon(icon, meta.icon);
      button.createSpan({ cls: 'como-settings-tab-label', text: meta.label });
      button.addEventListener('click', () => {
        this.comoActiveTab = id;
        this.display();
      });
    }

    const content = containerEl.createDiv({ cls: 'como-settings-pane' });

    switch (this.comoActiveTab) {
      case 'notes':
        renderBkemoSettings(content, this.plugin, {
          app: this.app,
          onRefresh: () => this.display(),
        });
        break;
      case 'chat':
        this.renderGeneralTab(content);
        rebrandCodianCopy(content);
        break;
      case 'providers':
        void this.renderProvidersTab(content, registeredProviderIds, displayGeneration).then(() => {
          rebrandCodianCopy(content);
        });
        break;
      default:
        break;
    }
  }
}

/** Soft-rebrand leftover Codian product strings inside shared Codian panes. */
function rebrandCodianCopy(root: HTMLElement): void {
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (text && /Codian|codian/.test(text)) {
        node.textContent = text
          .replace(/\bCodian\b/g, 'como')
          .replace(/\bcodian\b/g, 'como');
      }
      return;
    }
    for (const child of Array.from(node.childNodes)) walk(child);
  };
  walk(root);
}
