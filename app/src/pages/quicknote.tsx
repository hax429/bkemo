import { observer } from "mobx-react-lite";
import { BlinkoEditor } from "@/components/BlinkoEditor";
import { RootStore } from "@/store";
import { BlinkoStore } from "@/store/blinkoStore";
import { useEffect, useRef } from "react";
import { isInTauri } from "@/lib/tauriHelper";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useTranslation } from "react-i18next";

const QuickNotePage = observer(() => {
  const blinko = RootStore.Get(BlinkoStore);
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const lastHeightRef = useRef<number>(0);
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Detect container height and resize window with debouncing
  const checkAndResizeWindow = async () => {
    if (!isInTauri() || !containerRef.current) return;

    const height = containerRef.current.scrollHeight;

    // Skip adjustment if height hasn't changed significantly
    if (Math.abs(height - lastHeightRef.current) < 5) {
      return;
    }

    if (height > 0 && height !== lastHeightRef.current) {
      try {
        console.log(`Attempting to resize window: ${lastHeightRef.current} -> ${height}`);
        await invoke('resize_quicknote_window', { height});
        lastHeightRef.current = height;
      } catch (error) {
        console.error('Failed to resize window:', error);
      }
    }
  };

  // Debounced version of resize function
  const debouncedResize = () => {
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }
    resizeTimeoutRef.current = setTimeout(() => {
      checkAndResizeWindow();
    }, 100);
  };

  useEffect(() => {
    // Ensure in create mode
    blinko.isCreateMode = true;

    // Disable auto navigation - quicknote window should not navigate
    const originalNavigate = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    // Override history API to prevent navigation
    window.history.pushState = function () {
      console.log('Navigation blocked in quicknote window');
      return;
    };

    window.history.replaceState = function () {
      console.log('Navigation blocked in quicknote window');
      return;
    };

    // Set page title
    if (isInTauri()) {
      document.title = t('quicknote.title');
    }

    // Set body overflow to hidden for full-height layout
    document.body.style.overflow = 'hidden';

    // Auto focus to editor
    const timer = setTimeout(() => {
      const editorElement = document.getElementById('quicknote-editor');
      if (editorElement) {
        const textArea = editorElement.querySelector('textarea');
        const contentEditable = editorElement.querySelector('[contenteditable="true"]');

        if (textArea) {
          textArea.focus();
        } else if (contentEditable) {
          (contentEditable as HTMLElement).focus();
        } else {
          editorElement.focus();
        }
      }
    }, 100);

    // Initial window size check
    const initialCheckTimer = setTimeout(() => {
      debouncedResize();
    }, 200);

    // Listen for DOM changes and auto-resize window accordingly
    const observer = new MutationObserver(() => {
      debouncedResize();
    });

    if (containerRef.current) {
      observer.observe(containerRef.current, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });
    }

    // Listen for window resize events
    const resizeHandler = () => {
      debouncedResize();
    };
    window.addEventListener('resize', resizeHandler);

    return () => {
      clearTimeout(timer);
      clearTimeout(initialCheckTimer);
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      observer.disconnect();
      window.removeEventListener('resize', resizeHandler);
      // Restore original history API
      window.history.pushState = originalNavigate;
      window.history.replaceState = originalReplaceState;
    };
  }, []);

  const handleSend = async () => {
    // Call toggle method to close window after sending note - Tauri only
    if (isInTauri()) {
      try {
        console.log('Calling toggle_quicknote_window to close');
        // Call Rust toggle method - consistent with hotkey behavior
        await invoke('toggle_quicknote_window');
      } catch (error) {
        console.error('Failed to toggle quicknote window:', error);
      }
    }
  };

  return (
    <div className="w-full h-full p-0 m-0 overflow-hidden">
      <div
        ref={containerRef}
        data-tauri-drag-region
        id="quicknote-editor"
        className="w-full h-full bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
      >
        <BlinkoEditor
          mode="create"
          onSended={handleSend}
          withoutOutline={true}
        // height={undefined} - let editor auto-adjust height 
        />
      </div>
    </div>
  );
});

export default QuickNotePage;