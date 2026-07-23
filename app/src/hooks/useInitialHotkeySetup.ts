import { useEffect } from 'react';
import { isInTauri, isDesktop } from '@/lib/tauriHelper';
import { invoke } from '@tauri-apps/api/core';
import { enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { DEFAULT_HOTKEY_CONFIG } from '@shared/lib/types';

export const QUICKNOTE_HOTKEY_ERROR_KEY = 'bkemo.quicknoteHotkeyError';
const AUTOSTART_DEFAULT_KEY = 'bkemo.autostartDefaulted';
const TOGGLE_MAIN_HOTKEY = 'Control+Q';

export const useInitialHotkeySetup = () => {
  useEffect(() => {
    if (!isInTauri() || !isDesktop()) return;
    if (/^\/quick(note|ai|tool)/.test(window.location.pathname)) return;

    const setupInitialHotkeys = async () => {
      try {
        const blinko = RootStore.Get(BlinkoStore);
        await blinko.config.call(); // Ensure config is loaded
        
        const config = await blinko.config.value?.desktopHotkeys;
        const finalConfig = {
          ...DEFAULT_HOTKEY_CONFIG,
          ...config,
          windowBehavior: 'show' as const
        };
        
        console.log('Setting up initial hotkeys with config:', finalConfig);

        await invoke('set_tray_visible', {
          visible: finalConfig.systemTrayEnabled || !finalConfig.enabled
        });

        // Default start-at-login on first desktop launch (user can disable in Settings).
        try {
          if (!localStorage.getItem(AUTOSTART_DEFAULT_KEY)) {
            const already = await isEnabled();
            if (!already) await enable();
            localStorage.setItem(AUTOSTART_DEFAULT_KEY, '1');
          }
        } catch (error) {
          console.warn('Failed to enable default autostart:', error);
        }
        
        // Register quicknote shortcut if enabled
        if (finalConfig.enabled) {
          try {
            await invoke('register_hotkey', {
              shortcut: finalConfig.quickNote,
              command: 'quicknote'
            });
            localStorage.removeItem(QUICKNOTE_HOTKEY_ERROR_KEY);
            console.log('Initial registration - quicknote shortcut:', finalConfig.quickNote);
          } catch (error) {
            localStorage.setItem(
              QUICKNOTE_HOTKEY_ERROR_KEY,
              error instanceof Error ? error.message : String(error)
            );
            console.warn('Failed to register initial quicknote shortcut:', error);
          }
        }
        
        // Register quickai shortcut if enabled
        if (finalConfig.aiEnabled) {
          try {
            await invoke('register_hotkey', {
              shortcut: finalConfig.quickAI,
              command: 'quickai'
            });
            console.log('Initial registration - quickai shortcut:', finalConfig.quickAI);
          } catch (error) {
            console.warn('Failed to register initial quickai shortcut:', error);
          }
        }

        // Global show/hide for the main window (separate from Quick Note).
        try {
          await invoke('register_hotkey', {
            shortcut: TOGGLE_MAIN_HOTKEY,
            command: 'toggle-main',
          });
          console.log('Initial registration - toggle main shortcut:', TOGGLE_MAIN_HOTKEY);
        } catch (error) {
          console.warn('Failed to register toggle-main shortcut:', error);
        }
        
        // Setup text selection monitoring if enabled
        if (finalConfig.textSelectionToolbar.enabled) {
          try {
            await invoke('setup_text_selection_monitoring', {
              enabled: true,
              triggerModifier: finalConfig.textSelectionToolbar.triggerModifier
            });
            console.log('Text selection monitoring enabled with trigger:', finalConfig.textSelectionToolbar.triggerModifier);
          } catch (error) {
            console.warn('Failed to setup text selection monitoring:', error);
          }
        }
      } catch (error) {
        console.error('Failed to setup initial hotkeys:', error);
      }
    };

    // Setup hotkeys after a short delay to ensure app is fully initialized
    const timer = setTimeout(() => {
      setupInitialHotkeys();
    }, 1000);

    return () => {
      clearTimeout(timer);
    };
  }, []);
};
