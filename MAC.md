# bkemo macOS — Plan, Native Direction & Quick Note

**Server:** `https://bk.hax429.me` · **Stack:** Tauri v2 + the shared `dist/public`
web build · **Bundle ID:** `me.hax429.bk` · **Team:** `5L7AP54366`

macOS is a sibling of the iOS shell ([`IOS.md`](./IOS.md)) — same WKWebView over
the same web build, same offline-first model. This doc covers what's **macOS-specific**:
native chrome, the global-shortcut **Quick Note**, and signing/distribution.

## 1. Principles

- **One coherent UI everywhere.** Web, iOS, and macOS render the *same* `dist/public`
  React app. No platform forks of screens. Native code only *wraps* the web UI
  (windows, menus, shortcuts, notifications) — it never reimplements a screen.
  See the "coherent UI" contract in [`MOBILE_CLIENT_DESIGN.md`](./MOBILE_CLIENT_DESIGN.md) §1.
- **Native where it makes the app feel faster / lighter.** Prefer real macOS
  affordances (menu bar, status item, `NSPanel` quick-capture, native notifications,
  vibrancy titlebar, native file/share dialogs) over web reimplementations. The
  *content* stays web; the *frame* goes native.
- **Offline-first, like iOS.** Reads from the IndexedDB note cache + attachment
  cache; writes queue locally (`offlineNoteStorage` / `offlinePendingOps`) and
  replay on `app:online`. The frontend ships in the `.app` so cold launch works
  with no network.
- **Updates:** macOS keeps the existing full-app `tauri-plugin-updater`
  (GitHub-releases `latest.json`, `tauri.conf.json`) for native/Rust changes.
  Frontend-only changes ride the same OTA bundle path as iOS once the
  `bundle://` window-URL flip lands (Phase 8 — shared with iOS, see IOS.md §2.2);
  Gatekeeper/notarization is why macOS *also* keeps the full-app updater as the
  native channel.

## 2. Native-elements direction (the "make it feel native" track)

Coherent web UI inside, native frame outside. Target list, roughly in priority:

| Area | Native element | Status / notes |
|---|---|---|
| **Quick capture** | Global shortcut → floating **`NSPanel`** Quick Note | §3 — most of it exists; needs startup registration + panel polish |
| Menu bar | Real macOS app menu (File ▸ New Note, Edit, Window, Help) + ⌘N / ⌘, accelerators | Tauri `Menu` API; map to `bkemo:*` events the web app already emits |
| Status item | Menu-bar tray with Quick Note / Open / Quit | **Exists** (`desktop/tray.rs` — "Quick Note" item already wired) |
| Notifications | `tauri-plugin-notification` (UNUserNotificationCenter) for due tasks | **Wired** (Cargo + capability + `taskNotifications.ts`); needs a native rebuild to activate |
| Titlebar | Vibrancy / unified transparent titlebar (`titleBarStyle: Overlay`, `NSVisualEffectView`) | Config + a small Swift/objc tweak; keep traffic lights |
| Global shortcuts | `tauri-plugin-global-shortcut` | **Exists** (`desktop/hotkey.rs`, `desktop/setup.rs` handler) |
| File / share | Native open/save panels; macOS share sheet | `tauri-plugin-dialog` present; share sheet is a follow-up |
| Offline smoothness | Same caches as iOS; verify cold-launch + queue replay on macOS | Test lane in §5 |

> **Performance principle:** native chrome (menu, panel, status item, notifications)
> renders instantly and off the web thread, so the app feels responsive even while
> the WebView is warming up or offline. Keep heavy work in the native layer where
> it removes a web round-trip (global shortcut, file dialogs, notifications).

## 3. Quick Note — global-shortcut fast capture (Apple "Quick Note" style)

**Goal:** press a global hotkey anywhere in macOS → a small floating capture panel
appears instantly, type a note, ⌘↵ saves and dismisses. Works offline (queues +
syncs). Like Apple Notes' Quick Note, but for bkemo.

### 3.1 What already exists (desktop)
- **Window**: `toggle_quicknote_window` creates/toggles a 600×150 webview at the
  `/quicknote` route (`app/src-tauri/src/desktop/window.rs`); `resize_quicknote_window`
  grows it with content. The page is `app/src/pages/quicknote.tsx` (TipTap composer).
- **Shortcut plumbing**: `tauri-plugin-global-shortcut` is registered on desktop
  (`lib.rs`), with a handler (`desktop/setup.rs:create_global_shortcut_handler`)
  that dispatches a matched shortcut → `toggle_quicknote_window`. `register_hotkey`/
  `unregister_hotkey` commands + a `HotkeyConfig` default of **`Shift+Space`** for
  quick note (`desktop/hotkey.rs`).
- **Tray**: a "Quick Note" status-bar item already calls the same toggle.
- **Capture → save**: `/quicknote` saves via the same store + offline queue as the
  main app, so captures work offline and sync on reconnect.

### 3.2 The gaps to close
1. **Startup registration.** `setup_default_shortcuts()` exists but is dead code
   (`#[allow(dead_code)]`, never called) — and the legacy `HotkeySetting.tsx` that
   used to call `register_hotkey` is not surfaced in the bkemo `SettingsScreen`.
   → On a fresh bkemo build **no global shortcut is registered**. Fix: call
   `setup_default_shortcuts(app.handle())` in `desktop/setup.rs:setup_app`, reading
   a saved override first (persist the chosen shortcut).
2. **Native panel feel.** The quicknote window is an ordinary webview window. Make
   it an `NSPanel`: `.nonactivating`, `.canJoinAllSpaces` + `.fullScreenAuxiliary`
   (appears over the current app/space without stealing focus from the frontmost
   app), floating level, no Dock icon, rounded + vibrancy. Tauri exposes
   `always_on_top`, `decorations`, `skip_taskbar`, `visible_on_all_workspaces`;
   the true `NSPanel` behavior (non-activating) needs a small objc tweak on the
   `NSWindow` in the macOS setup path.
3. **Keyboard UX.** Esc dismisses, ⌘↵ saves+dismisses, autofocus the editor on show,
   restore focus to the previous app on dismiss. Some of this is in `quicknote.tsx`;
   verify under the panel.
4. **Settings.** Add a **Quick Capture** section to bkemo `SettingsScreen.tsx`:
   enable/disable + record a custom shortcut (reuse `register_hotkey`/`unregister_hotkey`),
   persisted via `bkemoSettings.ts`. Default `⌃⌥N` (Control-Option-N) — avoid
   `Shift+Space` as a *default* since it eats the space bar in some contexts; keep
   `Shift+Space` selectable.

### 3.3 Phased tasks

| # | Task | Where | Status |
|---|---|---|---|
| Q1 | Call `setup_default_shortcuts` on startup; read saved override | `desktop/setup.rs`, `desktop/hotkey.rs` | ⏳ |
| Q2 | Persisted Quick Capture setting (toggle + custom shortcut) | `SettingsScreen.tsx`, `bkemoSettings.ts` | ⏳ |
| Q3 | Promote quicknote window to a non-activating `NSPanel` (objc tweak) | new `desktop/panel.rs` (`#[cfg(target_os="macos")]`) | ⏳ |
| Q4 | Quick Note keyboard UX (Esc / ⌘↵ / autofocus / focus restore) | `pages/quicknote.tsx` | ⏳ |
| Q5 | Verify offline capture + sync from the panel | test lane §5 | ⏳ |
| Q6 | App menu File ▸ New Quick Note accelerator | `desktop/` menu setup | ⏳ |

## 4. Build, sign, notarize, distribute (Phase 5)

Build:
```bash
bun --cwd app run tauri:desktop:build
# → app/src-tauri/target/release/bundle/macos/bkemo.app
open app/src-tauri/target/release/bundle/macos/bkemo.app
```

Sign + notarize + staple (full recipe in [`IOS.md`](./IOS.md) §5.6):
```bash
codesign --force --deep --sign "Developer ID Application: <NAME> (5L7AP54366)" \
  app/src-tauri/target/release/bundle/macos/bkemo.app
ditto -c -k --sequesterRsrc --keepParent <app> bkemo.zip
xcrun notarytool submit bkemo.zip --apple-id bondi240827@gmail.com --team-id 5L7AP54366 --wait
xcrun stapler staple <app>
```

Distribution: GitHub Releases `latest.json` consumed by `tauri-plugin-updater`
(`app/src-tauri/tauri.conf.json`). Account: `bondi240827@gmail.com` (NOT
`hax42g@gmail.com`) — see IOS.md §10.

## 5. Test lane (macOS)

Part of the [`WORKFLOW.md`](./WORKFLOW.md) test matrix when desktop code changed:

- [ ] `cargo check` (desktop) + `cargo test` pass.
- [ ] `.app` builds and launches on macOS Sequoia.
- [ ] Global shortcut opens Quick Note from any app; ⌘↵ saves; Esc dismisses.
- [ ] Quick Note capture **offline** queues and syncs on reconnect.
- [ ] Due-task notification fires while backgrounded.
- [ ] Cold launch with no network renders the shell + cached notes.
- [ ] Status-item menu (Quick Note / Open / Quit) works.

## 6. Roadmap (macOS)

1. **Quick Note** Q1–Q4 (startup registration + native panel + settings) — the
   headline ask; unblocks the Apple-Quick-Note workflow.
2. **App menu + accelerators** (⌘N / ⌘, / ⌘W) mapped to existing `bkemo:*` events.
3. **Phase 5 signing/notarization** + first GitHub Release.
4. **Native titlebar vibrancy** + share sheet polish.
5. Share the **OTA** path with iOS once the `bundle://` flip is device-verified.

## Cross-references
- [`WORKFLOW.md`](./WORKFLOW.md) — how a macOS change reaches production.
- [`IOS.md`](./IOS.md) — shared Tauri/offline architecture, signing recipes, device info.
- [`MOBILE_CLIENT_DESIGN.md`](./MOBILE_CLIENT_DESIGN.md) — coherent-UI + OTA + notifications design.
- [`MCP.md`](./MCP.md) — the planned MCP server over the REST API.
