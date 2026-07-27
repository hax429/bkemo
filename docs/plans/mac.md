# bkemo macOS — Tauri Quick-Capture Shell (Plan)

**Server:** `https://bk.hax429.me`  
**Stack:** Tauri v2 (`app/src-tauri/`), shared React frontend, `tauri-plugin-global-shortcut`  
**Last updated:** 2026-07-23  
**Companion:** [`IOS.md`](./IOS.md) (native SwiftUI; Tauri iOS retired). macOS stays on Tauri.

---

## 1. Goal

Ship a reliable macOS desktop shell whose primary job is:

> Press **⌃W** (Control+W) anywhere → quick-note editor opens, focused, ready to type a new memo.

Speed of capture beats feature parity with the web app. The full bkemo UI remains available in the main window; the hero path is the existing `/quicknote` floating window.

### In scope (v1)

- macOS default global shortcut **⌃W** → show `/quicknote` with TipTap focused.
- Remappable hotkeys via existing Hotkey Settings (do not hardcode forever).
- Second ⌃W, Escape, or × hides Quick Note while preserving its draft.
- Registration failure UX (permission / conflict) — never silent no-op.
- Document macOS Accessibility / Input Monitoring first-run steps.
- Keep tray + existing desktop hotkey plumbing working.

### Explicit non-goals (v1)

- Cold-start the app from ⌃W when bkemo is not running (LaunchAgent / login item = Phase 2).
- Native SwiftUI macOS rewrite (deferred; iOS owns the native Apple path).
- Changing Windows/Linux default shortcuts.
- Auto-update, release signing, and notarization. The desktop updater is removed
  until distribution becomes a product goal.
- AI quick window, text-selection toolbar, or main-window editor as the ⌃W target.

### Success criteria

| # | Goal | Success criteria |
|---|------|------------------|
| G1 | ⌃W opens quicknote while app is running (incl. tray-only) | Window visible, TipTap focused, cursor ready ≤300 ms |
| G2 | Repeat ⌃W hides without discarding in-progress text | Reopen restores the exact draft and focuses TipTap |
| G3 | Fresh draft on open-from-shortcut | Editor is create-mode memo; empty (or cleared) ready for a new note |
| G4 | Remappable | Settings → change chord → old unregisters, new registers; persists across relaunch |
| G5 | Conflict / permission failure | Failed register → visible warning in Settings (and toast if practical); shortcut does not silently die |
| G6 | Unauthenticated / offline | Composer still opens; save queues or shows compact sign-in — blank editor is never blocked |
| G7 | Platform isolation | Windows/Linux keep current defaults (`Shift+Space` / `Alt+Space` unless user changed them) |

---

## 2. Architecture

### 2.1 Shape

Reuse the existing Tauri desktop shell. No new top-level package.

```
app/src-tauri/          Rust: hotkeys, windows, tray
app/src/pages/quicknote.tsx
app/src/hooks/useInitialHotkeySetup.ts
app/src/components/BlinkoSettings/HotkeySetting.tsx
shared/lib/types        HotkeyConfig + DEFAULT_HOTKEY_CONFIG
```

Runtime flow:

```
⌃W (global) ──▶ tauri-plugin-global-shortcut
                    │
                    ▼
            shortcut handler (setup.rs)
                    │
                    ▼
         toggle_quicknote_window()
                    │
                    ├─ show + focus webview "quicknote"
                    └─ emit event → QuickNotePage: ensure create-mode memo, focus TipTap
```

### 2.2 Why not the main window editor

Main-window TipTap/NoteModal is slower (shell, auth chrome, layout) and fights “press → type.” `/quicknote` already exists, is always-on-top, decoration-light, and wired to hotkeys/tray. ⌃W targets that surface only.

### 2.3 Relation to iOS

| Platform | Client | Capture entry |
|----------|--------|---------------|
| iOS | Native SwiftUI (`ios/`) | App icon / widget / share |
| macOS | Tauri desktop | ⌃W → `/quicknote` |
| Web | Vite React | In-app composer / modal |

Do not merge the iOS SwiftUI app into this plan. Do not revive Tauri iOS for macOS work.

---

## 3. Shortcut behavior (locked)

| Topic | Decision |
|-------|----------|
| Chord | **Control+W** (`Ctrl+W` / `⌃W`), **not** ⌘W |
| Why not ⌘W | System/app “close window” — permanent conflict |
| macOS default | `Control+W` in Rust `HotkeyConfig::default` and frontend `DEFAULT_HOTKEY_CONFIG` when `target_os = macos` (or equivalent platform branch) |
| Other OS defaults | Unchanged (`Shift+Space` quicknote, `Alt+Space` quickai) |
| Configurable | Yes — Hotkey Settings remain source of truth after first save |
| App running | Required for v1 (including background/tray) |
| Cold start via shortcut | Phase 2 |
| Note type | Always **memo** on shortcut open; todo via in-window toggle |
| Latency target | ≤300 ms keypress → keyboard-ready when process already live |

### 3.1 Quick Note window semantics

1. If hidden, ⌃W shows and focuses the rounded capture panel.
2. If visible, ⌃W hides it.
3. Escape and × also hide it.
4. Hiding never clears content; the account-scoped draft survives app quit and
   is shared with the normal web composer.
5. Changes persist locally immediately and autosave to the server two seconds
   after typing stops. Only explicit Save creates a memo and clears the draft.
6. While offline, editing remains local; final Save waits for connectivity
   rather than turning the compose draft into a saved note.

---

## 4. Permissions & conflicts

### 4.1 macOS permissions

Global shortcuts may require the user to grant Input Monitoring and/or Accessibility for the bkemo app (OS version dependent).

Plan must include:

- First-run / Settings copy: how to open System Settings → Privacy & Security → grant bkemo.
- Detect `register_hotkey` failure → surface in Hotkey Settings (red status + “Open System Settings” deep link if available).
- Re-try register on Settings focus / app activate.

### 4.2 Shortcut already taken

If another app owns ⌃W:

- Registration fails → warning with the failed chord + suggestion to pick another in Settings.
- Do not fall back silently to `Shift+Space` without telling the user (optional soft-suggest only in the warning copy).

---

## 5. Auth & offline

Align with product offline conventions in `docs/agents/PROJECT.md`:

- Shortcut always opens the composer.
- If signed out: show compact sign-in in the quicknote chrome *without* removing the editor, or allow typing and prompt on save — pick the lighter of the two when implementing; never block the blank field behind a full-screen gate.
- If offline: queue write via existing desktop offline path; user can keep typing.

---

## 6. Implementation plan

### Phase 0 — Baseline verify

1. Run macOS Tauri desktop build; confirm `/quicknote` window exists (`tauri.conf.json` label `quicknote`).
2. Confirm the macOS default ⌃W toggles without losing drafts.
3. Confirm Hotkey Settings round-trip register/unregister.

### Phase 1 — ⌃W + open semantics (v1 ship)

| Step | Change | Files (expected) |
|------|--------|------------------|
| 1 | Platform-specific default `Control+W` on macOS | `app/src-tauri/src/desktop/hotkey.rs`, `shared` `DEFAULT_HOTKEY_CONFIG` / frontend defaults |
| 2 | Make `toggle_quicknote_window` preserve the mounted draft | `app/src-tauri/src/desktop/window.rs` |
| 3 | Wire shortcut handler + tray quick-note to show/focus | `setup.rs`, `tray.rs` |
| 4 | Emit frontend event; focus TipTap; memo create-mode; preserve unsaved | `quicknote.tsx` |
| 5 | Registration failure UI | `HotkeySetting.tsx` (+ optional toast) |
| 6 | macOS permission help text | Settings copy / short note in this plan’s runbook §8 |
| 7 | Keep remapping + persistence | existing `register_hotkey` / config store |

### Phase 2 — Follow-ons (out of v1 success gate)

- Login item / LaunchAgent so ⌃W works when app was quit.
- Measure and optimize cold webview focus latency.
- Optional: separate menu-bar-only helper process (only if tray+full app proves too heavy).

---

## 7. Non-goals & cuts

| Cut | Reason |
|-----|--------|
| ⌘W | Closes windows; unusable as global capture |
| Main-window NoteModal as ⌃W target | Too slow / heavy for capture |
| Hardcoded non-remappable ⌃W | Users need escape hatch on conflict |
| Hide-on-second-⌃W | Destroys capture habit and drafts |
| Windows/Linux default change | Not requested; avoid surprise |
| Unified Apple codebase (SwiftUI macOS) | iOS plan owns native; macOS reuses Tauri for now |
| Cold-start in v1 | Needs login-item design; defer |

---

## 8. Runbook (developer / first install)

1. Build & run desktop: from `app/` use the project’s existing Tauri macOS dev command.
2. On first ⌃W failure: System Settings → Privacy & Security → Input Monitoring (and Accessibility if prompted) → enable **bkemo** → relaunch.
3. Settings → Hotkeys → confirm Quick Note shows `Control+W` (macOS) and status “registered”.
4. Quit main window to tray (if tray enabled) → ⌃W should still open quicknote.
5. Type a memo → save → editor clears → ⌃W again → empty focused editor.
6. Type unsaved text → ⌃W again → window focuses, text still there.

---

## 9. Test plan

- [ ] macOS: fresh prefs → default quicknote chord is `Control+W`
- [ ] Windows/Linux (or code review): defaults still `Shift+Space` / `Alt+Space`
- [ ] ⌃W with main window focused → quicknote on top, TipTap focused
- [ ] ⌃W with another app focused → same
- [ ] ⌃W with quicknote already visible → hides
- [ ] Unsaved body survives hide and reopen
- [ ] After successful save, next ⌃W yields empty memo draft
- [ ] Remap to another chord → works; old chord inactive
- [ ] Force register failure (conflict) → Settings shows error, no silent success
- [ ] Signed out → composer still appears
- [ ] Offline save → queues / restores per existing desktop behavior
- [ ] Tray “Quick Note” uses same show/focus path as ⌃W

---

## 10. Locked decisions (from the grill)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Capture surface | Existing `/quicknote` Tauri window + TipTap |
| 2 | Chord | Control+W (⌃W), not ⌘W |
| 3 | Default vs config | macOS default ⌃W; Hotkey Settings remappable |
| 4 | Repeat press | Hide while preserving the draft |
| 5 | Process lifetime | App must be running (tray OK); no cold-start in v1 |
| 6 | Permissions | Document + fail visibly in Settings |
| 7 | Plan scope | Native-feeling local app; release/update work explicitly deferred |
| 8 | vs iOS | macOS = Tauri; iOS = SwiftUI; separate |
| 9 | Auth | Always open composer; don’t block blank editor |
| 10 | Note type | Memo on open; todo via UI toggle |
| 11 | Latency | ≤300 ms when app already running |
| 12 | Doc path | `docs/plans/mac.md` |
| 13 | Other platforms | Leave their defaults alone |
| 14 | Conflicts | Detect failure → warn + suggest remap |

---

## 11. Files likely to change

```
app/src-tauri/src/desktop/hotkey.rs       macOS default Control+W
app/src-tauri/src/desktop/window.rs       draft-preserving quicknote toggle
app/src-tauri/src/desktop/setup.rs        shortcut → show/focus
app/src-tauri/src/desktop/tray.rs         tray → same path
app/src/pages/quicknote.tsx               event → focus / draft policy
app/src/hooks/useInitialHotkeySetup.ts    platform default
app/src/components/BlinkoSettings/HotkeySetting.tsx
shared/lib/types (or equivalent)          DEFAULT_HOTKEY_CONFIG platform branch
docs/plans/mac.md                         this plan
```

Do not update `docs/agents/PROJECT.md` until implementation lands (same convention as IOS.md).

---

## 12. Cross-references

- [`../agents/PROJECT.md`](../agents/PROJECT.md) — product model, Tauri clients, offline conventions
- [`../agents/UI.md`](../agents/UI.md) — `.bkemo` theme; quicknote should stay on existing tokens
- [`./IOS.md`](./IOS.md) — native iOS; macOS explicitly out of that plan
- `app/src-tauri/tauri.conf.json` — `quicknote` window definition
- `app/src-tauri/src/desktop/hotkey.rs` — register / defaults
- `app/src/pages/quicknote.tsx` — capture UI
