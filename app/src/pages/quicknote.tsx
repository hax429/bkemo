import { observer } from "mobx-react-lite";
import { TiptapEditor, type TiptapEditorHandle } from "@/components/TiptapEditor";
import { RootStore } from "@/store";
import { BlinkoStore } from "@/store/blinkoStore";
import { UserStore } from "@/store/user";
import { NoteType } from "@shared/lib/types";
import { parseTaskSyntax } from "@/lib/taskSyntax";
import { extractNoteLinkIds, noteLinkTitle } from "@/lib/noteLinks";
import { toUpsertAttachment } from "@/lib/attachments";
import { useAttachments, PendingAttachments } from "@/components/bkemo/useAttachments";
import { useEffect, useRef, useState } from "react";
import { isInTauri } from "@/lib/tauriHelper";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { loadPrefs } from "@/lib/bkemoSettings";
import { deliverQuickNote } from "@/lib/quicknoteSubmit";

const QUICKNOTE_DRAFT_KEY = 'bkemo.quicknoteDraft';

const QuickNotePage = observer(() => {
  const blinko = RootStore.Get(BlinkoStore);
  const user = RootStore.Get(UserStore);
  const { t } = useTranslation();
  const editorRef = useRef<TiptapEditorHandle>(null);
  const [sending, setSending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => localStorage.getItem(QUICKNOTE_DRAFT_KEY) ?? '');
  const att = useAttachments();
  const containerRef = useRef<HTMLDivElement>(null);
  const lastHeightRef = useRef<number>(0);
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const focusEditor = () => {
    if (editorRef.current) {
      editorRef.current.focus();
      return;
    }

    const editorElement = document.getElementById('quicknote-editor');
    const focusTarget = editorElement?.querySelector<HTMLElement>(
      'textarea, [contenteditable="true"]'
    );
    (focusTarget ?? editorElement)?.focus();
  };

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
    document.body.style.background = 'transparent';

    // Auto focus to editor
    const timer = setTimeout(focusEditor, 100);

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
      document.body.style.background = '';
      // Restore original history API
      window.history.pushState = originalNavigate;
      window.history.replaceState = originalReplaceState;
    };
  }, []);

  useEffect(() => {
    const hideOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      void closeWindow();
    };
    window.addEventListener('keydown', hideOnEscape);
    return () => window.removeEventListener('keydown', hideOnEscape);
  }, []);

  useEffect(() => {
    if (!isInTauri()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen('quicknote-shortcut', () => {
      // Repeated shortcut presses must preserve unsaved editor content.
      blinko.isCreateMode = true;
      requestAnimationFrame(focusEditor);
    }).then((dispose) => {
      if (disposed) {
        dispose();
      } else {
        unlisten = dispose;
      }
    }).catch((error) => {
      console.error('Failed to listen for quicknote shortcut events:', error);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [blinko]);

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

    setSaveError(null);
    setSaveNotice(null);
    if (!user.token) {
      setSaveError('Sign in to bkemo in the main window before saving this note.');
      if (isInTauri()) {
        await invoke('toggle_editor_window').catch((error) => {
          console.error('Failed to show the bkemo sign-in window:', error);
        });
      }
      return;
    }

    setSending(true);
    try {
      let queuedOffline = false;
      await deliverQuickNote({
        // Call the mutation itself instead of PromiseState.call(), which catches
        // server/auth errors and otherwise makes a failed save look successful.
        save: async () => {
          const saved = await blinko.upsertNote.function({
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
          queuedOffline = !!(saved as any)?.isOffline;
          if (isInTauri() && saved) {
            await emit('native-note-changed', saved);
          }
          return saved;
        },
        clear: () => {
          editorRef.current?.clear();
          setDraft('');
          localStorage.removeItem(QUICKNOTE_DRAFT_KEY);
          att.clear();
        },
        hide: async () => {
          if (queuedOffline) {
            setSaveNotice('Saved locally · waiting to sync');
            return;
          }
          await closeWindow();
        },
      });
    } catch (error) {
      console.error('Quick note save failed:', error);
      setSaveError(error instanceof Error ? error.message : String(error));
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
        position: 'relative', width: '100%', minHeight: '100%', background: 'color-mix(in srgb, var(--bg) 91%, transparent)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', padding: 14, paddingTop: 18, boxSizing: 'border-box', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border-2)', boxShadow: '0 18px 50px rgba(0,0,0,0.38)',
        ...(prefs.accent ? { ['--accent' as any]: prefs.accent } : {})
      }}
    >
      <button
        onClick={closeWindow}
        aria-label="Close Quick Note"
        title="Hide Quick Note"
        style={{ position: 'absolute', top: 7, right: 8, zIndex: 2, width: 22, height: 22, border: 0, borderRadius: 7, background: 'transparent', color: 'var(--fg-3)', cursor: 'pointer', fontSize: 16, lineHeight: '22px' }}
      >
        ×
      </button>
      <TiptapEditor
        ref={editorRef}
        value={draft}
        placeholder={`${t('quicknote.title') || 'Quick memo'} · / for commands, ⌘↵ to save`}
        autofocus
        onSubmit={send}
        onChange={(markdown) => {
          setDraft(markdown);
          if (markdown) localStorage.setItem(QUICKNOTE_DRAFT_KEY, markdown);
          else localStorage.removeItem(QUICKNOTE_DRAFT_KEY);
        }}
        getTags={() => blinko.tagList.value?.pathTags ?? []}
        getNotes={async (q) => {
          const list = await blinko.queryNotes({ searchText: q, type: -1, isRecycle: false, isArchived: false }, 1, 8);
          return list.filter((n) => n.id != null).map((n) => ({ id: n.id!, title: noteLinkTitle(n.content) }));
        }}
      />
      {saveError && (
        <div
          role="alert"
          style={{ color: 'var(--urgent)', fontSize: 12, marginTop: 8 }}
        >
          {saveError}
        </div>
      )}
      {saveNotice && (
        <div role="status" style={{ color: 'var(--important)', fontSize: 12, marginTop: 8 }}>
          {saveNotice}
        </div>
      )}
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