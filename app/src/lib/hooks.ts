import { useEffect, useState } from "react";
import { helper } from "./helper";
import { RootStore } from "@/store";
import { isAndroid, isInTauri } from '@/lib/tauriHelper';
import { eventBus } from '@/lib/event';

/**
 * Legacy Vditor edit-modal opener removed. Android share intents now emit an
 * event the bkemo app listens for to open the composer with the shared content
 * (handled in pages/bkemo).
 */
const ShowEditBlinkoModel = (_size: string, _mode: string, opts?: { text?: string; file?: File }) => {
  eventBus.emit('bkemo:quick-capture', opts ?? {});
};

import { readFile } from "@tauri-apps/plugin-fs";
import { FocusEditorFixMobile } from "@/lib/editorTypes";
import { ToastPlugin } from "@/store/module/Toast/Toast";

/**
 * Tracks the on-screen keyboard height via the visualViewport API.
 * On iOS WKWebView `position: fixed` does not reposition reliably when the
 * keyboard opens, so consumers must manually offset their layout by this value
 * (e.g. paddingBottom or translateY).
 */
export const useKeyboardOffset = () => {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const keyboardHeight = window.innerHeight - vv.height - vv.offsetTop;
      setOffset(keyboardHeight > 10 ? keyboardHeight : 0);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return offset;
};

interface HistoryBackProps<T extends string> {
  state: boolean;
  onStateChange: () => void;
  historyState: T;
}

export const useHistoryBack = <T extends string>({
  state,
  onStateChange,
  historyState
}: HistoryBackProps<T>) => {
  useEffect(() => {
    if (state) {
      try {
        const currentPath = window.location.pathname + window.location.search;
        history.pushState({
          [historyState]: true,
          timestamp: Date.now(),
          path: currentPath
        }, '', currentPath);
      } catch (error) {
        console.warn('History pushState failed:', error);
      }
    }

    const handlePopState = (event: PopStateEvent) => {
      if (state && event?.state) {
        onStateChange();
      }
    };

    try {
      window.addEventListener('popstate', handlePopState);
    } catch (error) {
      console.warn('Failed to add popstate listener:', error);
    }

    return () => {
      try {
        window.removeEventListener('popstate', handlePopState);
      } catch (error) {
        console.warn('Failed to remove popstate listener:', error);
      }
    };
  }, [state, onStateChange, historyState]);
};

export const useIsIOS = () => {
  const [isIOS, setIsIOS] = useState(false);
  useEffect(() => {
    setIsIOS(helper.env.isIOS());
  }, []);
  return isIOS;
};

// Global state for Android shortcuts handling
let androidShortcutsIntervalId: NodeJS.Timeout | null = null;
let isProcessingSharedData = false;
let isInitialized = false;

// Singleton function to initialize Android shortcuts listener
const initializeAndroidShortcuts = () => {
  if (isInitialized || !isAndroid() || !isInTauri()) {
    return;
  }

  isInitialized = true;

  const checkAndroidData = () => {
      // Handle shortcuts
      const action = window.localStorage.getItem('android_shortcut_action');
      if (action) {
        window.localStorage.removeItem('android_shortcut_action');
        switch (action) {
          case 'quick_note':
            ShowEditBlinkoModel('2xl', 'create');
            FocusEditorFixMobile()
            break;

          case 'voice_recording':
            ShowEditBlinkoModel('2xl', 'create');
            // Use eventBus to trigger audio recording after editor is ready
            setTimeout(() => {
              eventBus.emit('editor:startAudioRecording');
            }, 300);
            break;
        }
      }

      // Handle shared data
      const shareDataStr = window.localStorage.getItem('android_share_data');
      if (shareDataStr && !isProcessingSharedData) {
        isProcessingSharedData = true;
        // alert(shareDataStr)
        window.localStorage.removeItem('android_share_data');
        try {
          const shareData = JSON.parse(shareDataStr);
          if (shareData.text) {
            // Remove surrounding quotes (single, double, backticks) and trim whitespace
            let cleanText = shareData.text.trim();
            if ((cleanText.startsWith('"') && cleanText.endsWith('"')) ||
                (cleanText.startsWith("'") && cleanText.endsWith("'")) ||
                (cleanText.startsWith('`') && cleanText.endsWith('`'))) {
              cleanText = cleanText.slice(1, -1);
            }
            ShowEditBlinkoModel('2xl', 'create', { text: cleanText });
            isProcessingSharedData = false;
          }
          else if (shareData.stream && shareData.content_type) {
            readFile(shareData.stream).then(contents => {
              const file = new File([contents], shareData.name || 'shared_file', {
                type: shareData.content_type
              });
              console.log('xxx!!!')
              ShowEditBlinkoModel('2xl', 'create', { file });
              isProcessingSharedData = false;
            }).catch((error: Error) => {
              console.warn('fetching shared content failed:', error);
              RootStore.Get(ToastPlugin).error(error?.message)
              isProcessingSharedData = false;
            });
          }
          else {
            ShowEditBlinkoModel('2xl', 'create');
            isProcessingSharedData = false;
          }
        } catch (e) {
          console.error('Failed to parse share data:', e);
          // Fallback: just open create modal
          RootStore.Get(ToastPlugin).error(e?.message)
          setTimeout(() => { isProcessingSharedData = false; }, 100);
        }
      }
    };

  // Start checking immediately
  checkAndroidData();

  // Register global interval (slower polling since Android injects with 1.5s delay)
  androidShortcutsIntervalId = setInterval(checkAndroidData, 800);
};

// Cleanup function
const cleanupAndroidShortcuts = () => {
  if (androidShortcutsIntervalId) {
    clearInterval(androidShortcutsIntervalId);
    androidShortcutsIntervalId = null;
  }
  isProcessingSharedData = false;
  isInitialized = false;
};

export const useAndroidShortcuts = () => {
  useEffect(() => {
    // Initialize only once globally
    initializeAndroidShortcuts();

    // Return cleanup function (cleanup when app unmounts)
    return () => {
      cleanupAndroidShortcuts();
    };
  }, []);
};



