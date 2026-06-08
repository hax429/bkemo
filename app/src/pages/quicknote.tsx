import { observer } from "mobx-react-lite";
import { TiptapEditor, type TiptapEditorHandle } from "@/components/TiptapEditor";
import { RootStore } from "@/store";
import { BlinkoStore } from "@/store/blinkoStore";
import { NoteType } from "@shared/lib/types";
import { parseTaskSyntax } from "@/lib/taskSyntax";
import { extractNoteLinkIds, noteLinkTitle } from "@/lib/noteLinks";
import { toUpsertAttachment } from "@/lib/attachments";
import { useAttachments, PendingAttachments } from "@/components/bkemo/useAttachments";
import { useEffect, useRef, useState } from "react";
import { isInTauri } from "@/lib/tauriHelper";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { loadPrefs } from "@/lib/bkemoSettings";

const QuickNotePage = observer(() => {
  const blinko = RootStore.Get(BlinkoStore);
  const { t } = useTranslation();
  const editorRef = useRef<TiptapEditorHandle>(null);
  const [sending, setSending] = useState(false);
  const att = useAttachments();
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
    // Load tags for #-autocomplete in this standalone window.
    if (!blinko.tagList.value) blinko.tagList.call();

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

  const closeWindow = async () => {
    // Close the quicknote window after sending - Tauri only.
    if (isInTauri()) {
      try {
        await invoke('toggle_quicknote_window');
      } catch (error) {
        console.error('Failed to toggle quicknote window:', error);
      }
    }
  };

  const send = async () => {
    if (sending) return;
    const raw = editorRef.current?.getMarkdown()?.trim() ?? '';
    // Inline task syntax: `-[]` promotes to a task, `due:…` sets the due date.
    const parsed = parseTaskSyntax(raw);
    if (!parsed.content && !parsed.isTodo && att.items.length === 0) return;
    setSending(true);
    try {
      await blinko.upsertNote.call({
        content: parsed.content,
        type: parsed.isTodo ? NoteType.TODO : NoteType.BLINKO,
        references: extractNoteLinkIds(parsed.content),
        attachments: att.items.map(toUpsertAttachment),
        // Priority tags (`#important` / `#urgent`) apply to any memo.
        isImportant: !!parsed.isImportant,
        isUrgent: !!parsed.isUrgent,
        ...(parsed.isTodo ? { dueDate: parsed.dueDate ?? null } : {}),
        showToast: false,
      });
      editorRef.current?.clear();
      att.clear();
      await closeWindow();
    } catch (error) {
      console.error('Quick note save failed:', error);
    } finally {
      setSending(false);
    }
  };

  const prefs = loadPrefs();
  const preset = prefs.theme === 'light' ? 'light' : (prefs.accent?.toLowerCase() === '#5e6ad2' ? 'developer' : (prefs.accent?.toLowerCase() === '#e2a96b' ? 'coffee' : 'dusk'));

  return (
    // Plain .bkemo token scope (no fixed positioning) so the window can size to
    // content via the MutationObserver above.
    <div
      ref={containerRef}
      data-tauri-drag-region
      id="quicknote-editor"
      className="bkemo"
      data-theme={prefs.theme}
      data-density={prefs.density}
      data-preset={preset}
      {...att.dragProps}
      style={{
        width: '100%', minHeight: '100%', background: 'color-mix(in srgb, var(--bg) 88%, transparent)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', padding: 14, boxSizing: 'border-box',
        ...(prefs.accent ? { ['--accent' as any]: prefs.accent } : {})
      }}
    >
      <TiptapEditor
        ref={editorRef}
        placeholder={`${t('quicknote.title') || 'Quick memo'} · / for commands, ⌘↵ to save`}
        autofocus
        onSubmit={send}
        getTags={() => blinko.tagList.value?.pathTags ?? []}
        getNotes={async (q) => {
          const list = await blinko.queryNotes({ searchText: q, type: -1, isRecycle: false, isArchived: false }, 1, 8);
          return list.filter((n) => n.id != null).map((n) => ({ id: n.id!, title: noteLinkTitle(n.content) }));
        }}
      />
      {att.fileInput}
      <PendingAttachments items={att.items} uploading={att.uploading} onRemove={att.remove} />
      <div className="h-stack" style={{ gap: 8, marginTop: 10, alignItems: 'center' }}>
        <button onClick={att.openPicker} title="Attach a file" style={{ background: 'transparent', border: 'none', color: 'var(--fg-2)', fontSize: 15, cursor: 'pointer', padding: 2 }}>📎</button>
        <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>⌘↵ to save</span>
        <span className="spacer" />
        <button
          onClick={send}
          disabled={sending || att.uploading > 0}
          style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '4px 14px', fontSize: 12, fontWeight: 500, opacity: (sending || att.uploading > 0) ? 0.6 : 1, cursor: 'pointer' }}
        >Send</button>
      </div>
    </div>
  );
});

export default QuickNotePage;