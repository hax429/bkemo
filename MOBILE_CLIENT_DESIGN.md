# bkemo macOS / iOS client — design

**Server:** `https://bk.hax429.me`  ·  **Stack:** Tauri v2 + the same React web build  ·  **Bundle ID:** `me.hax429.bk`

This doc is the *current* design for the desktop/mobile clients. The exhaustive
historical plan + build/verification recipes live in [`IOS.md`](./IOS.md); this
file focuses on **what the clients must do** and the **two remaining gaps**
(OTA frontend update, task notifications) on top of the shipped foundation.

## 1. Principles
- **One UI everywhere.** macOS and iOS are Tauri **WKWebView shells** loading the
  *same* `dist/public` web build. No platform forks of screens. No backend code
  in the app — all data goes to `https://bk.hax429.me/api/*` via `getBlinkoEndpoint()`.
- **Offline-first.** The shell loads from disk; reads come from an IndexedDB note
  cache; writes queue locally and replay on reconnect.
- **Frontend ships over-the-air.** A web change (e.g. an element repositioned)
  reaches installed iOS/macOS clients on next launch without an App Store release.

## 2. Requirement → status map

| Requirement | How | Status |
|---|---|---|
| Same UI on macOS + iOS | Tauri WKWebView over `dist/public` | ✅ shipped (IOS.md Ph0–3) |
| Connect to `bk.hax429.me` | `blinkoEndpoint.ts` defaults to it in Tauri | ✅ shipped |
| Offline **read** | `noteCache.ts` (Dexie/IndexedDB) + `attachmentCache.ts` | ✅ shipped (Ph4) |
| Offline **create / edit / delete** | `offlineNoteStorage` + `offlinePendingOps`, replayed on `app:online` | ✅ shipped (Ph4) |
| Native **quick capture** | desktop: `quicknote` window + `global-shortcut`; mobile: `bkemo:quick-capture` event (Android share intent wired) | ✅ desktop / ⚠️ iOS entry pending (§5) |
| **In-app update** (web changes w/o store release) | **OTA bundle updater (Phase 8)** | ⏳ **this doc §3** |
| **iOS task notifications** | local notifications scheduled from due dates | ⏳ **this doc §4** |

macOS also keeps the existing full-app `tauri-plugin-updater` (GitHub releases) for
native/Rust changes; OTA only swaps the *frontend*.

### Implemented in this change
- **OTA server generator** — `scripts/build-app-bundle.ts` + `app` scripts
  `bundle:ota` / `build:web:ota`. Verified producing `dist/public/app-bundle/{manifest.json, bundle-<ver>.zip}`.
- **Task notifications (JS)** — `app/src/lib/taskNotifications.ts` (schedule/reconcile/cancel),
  a Tauri-gated scheduling effect in `pages/bkemo/index.tsx`, a `taskReminders`
  pref + Settings → Appearance toggle. `tsc` clean.
- **Notification native wiring** — `@tauri-apps/plugin-notification` (JS),
  `tauri-plugin-notification` (Cargo) registered in `src-tauri/src/lib.rs`,
  `notification:default` in `capabilities/{mobile,desktop}.json`. **Requires a
  native rebuild** (`cargo`/Xcode) to activate — not compiled in this environment.

- **OTA Rust layer** — `src-tauri/src/bundle_resolver.rs` (resolve path → file in
  active bundle, mime, atomic `bundle-state.json`, traversal guard) +
  `bundle_updater.rs` (fetch manifest → SHA-256-verify → extract → flip pointer →
  prune) + `bundle://` URI scheme registered in `src-tauri/src/lib.rs` (mobile),
  with the updater spawned in `setup()`. Cargo deps `zip`/`sha2`/`reqwest` added.
  Verified via `cargo check` (desktop + `aarch64-apple-ios-sim`) and `cargo test`
  (resolver/updater unit tests). **Landed behind the baseline:** the window still
  loads `tauri://localhost` until the one-line flip is device-verified.
- **Tests** — `app/vitest.config.ts` + `app/src/lib/__tests__/{taskNotifications,blinkoEndpoint}.test.ts`
  (8 passing) + Rust `#[cfg(test)]` units.

Still pending (native): the `bundle://localhost/index.html` **window-URL flip**
(one line in `tauri.ios.conf.json`, after on-device test) + iOS quick-capture
extension (§5). The OTA Rust modules themselves are done.

## 3. OTA in-app frontend update (Phase 8)

Goal G10: push to `dist/public` on the server → installed clients pick up the new
frontend on next launch, no store submission. Architecture is specified in
[`IOS.md` §2.2](./IOS.md) (`bundle://localhost` URI scheme + background updater).
Remaining work, smallest → largest:

**3a. Server bundle generator — `scripts/build-app-bundle.ts` (implemented here).**
Runs after `vite build`; zips `dist/public` into `dist/public/app-bundle/bundle-<version>.zip`
and writes `dist/public/app-bundle/manifest.json`:
```json
{ "version": "1.8.7", "sha256": "<hex>", "url": "/app-bundle/bundle-1.8.7.zip",
  "size": 1234567, "minNativeVersion": "1.8.0", "createdAt": "2026-…Z" }
```
`version` comes from root `package.json` (single source of truth). Served by the
existing `express.static('dist/public')` — no new routes. Exposed as a dedicated
script `build:web:ota` (= `build:web` + `bundle:ota`) used by **server deploys**;
native (Tauri) builds keep plain `build:web` so the redundant zip isn't baked
into the `.ipa`/`.app` (the baked baseline is `dist/public` itself).

**3b. App Rust side — ✅ implemented (landed behind baseline; native rebuild to activate).**
- `bundle_resolver.rs` + register `bundle://localhost/` URI scheme → serve from
  `<AppData>/bundles/<active>/`, fall back to the baked-in baseline. ✅
- `bundle_updater.rs` (spawned in `setup()`): GET `…/app-bundle/manifest.json`;
  if `version != active` → download zip, verify SHA-256, extract to
  `bundles/<new>/`, atomically write `bundle-state.json` → active next launch. ✅
- `tauri.ios.conf.json`: window URL → `bundle://localhost/index.html`. ⏳ **not yet
  flipped** — kept on `tauri://localhost` (baseline) until the on-device test passes.
- On `minNativeVersion` mismatch: warning + `bundle://min-native` event, app still
  usable (decision locked). ✅ (frontend toast wiring optional follow-up)

Roll-back safety: keep the previous extracted bundle; if the new one fails to
load, the resolver falls back. macOS can adopt the same scheme later but for now
keeps full-app updates.

## 4. iOS / macOS task notifications (new)

Goal: a TODO with a `dueDate` fires a **local OS notification** at its due time,
even if the app is backgrounded — using `@tauri-apps/plugin-notification`
(UNUserNotificationCenter on Apple, scheduled via the plugin's `schedule.at`).

**4.1 Scheduling model** — `app/src/lib/taskNotifications.ts` (implemented here):
- Stable id per task: `notificationId(noteId)` (deterministic 31-bit int) so a
  reschedule replaces, never duplicates.
- For each **open** task (`isTask && !isDone`) with a **future** `dueDate`:
  schedule one notification *at the due time* (title = first line, body = "Due now").
  Optionally a second "due soon" reminder N minutes before (setting).
- For done / deleted / past-due / cleared tasks: cancel the id.
- **Reconcile** (`syncTaskNotifications(tasks)`): diff desired vs. currently
  `pending()`; `cancel()` stale, `schedule()` new. Idempotent — safe to call on
  every task-list load and on `bkemo:updated`.
- Permission: request once (gated behind the user toggle); if denied, no-op.
- Tap → opens the app (deep-link to the task is a follow-up via the notification
  action payload).

**4.2 Where it runs:** a small effect in `pages/bkemo/index.tsx` (Tauri only)
queries open tasks (reusing `blinko.queryNotes({ isCompleted:false })`) and calls
`syncTaskNotifications` on mount, on `blinko.updateTicker` change, and on
`app:online`. A **Settings → Notifications** toggle (`bkemoSettings`:
`taskReminders`, default on for native) gates the whole thing.

**4.3 Native wiring (native rebuild required):**
- JS dep `@tauri-apps/plugin-notification`; Rust `tauri-plugin-notification = "2"`
  registered in `app/src-tauri/src/lib.rs`.
- Capability: add `notification:default` to `app/src-tauri/capabilities/mobile.json`
  (+ `desktop.json` for macOS).
- iOS: no Info.plist usage string needed (runtime permission prompt). macOS
  notifications work out of the box.
- Scheduled notifications fire at the OS level, so reminders work with the app
  closed — the JS only (re)computes the schedule while the app is open.

## 5. iOS quick capture (polish)
Desktop quick capture is a `global-shortcut`-toggled `quicknote` window. iOS has
no global shortcuts; the native entry points are: (a) a **Share Extension**
(share text/URL into bkemo → `bkemo:quick-capture`), (b) a **Home-screen / Control
Center widget** or **App Shortcut (Siri)** that deep-links to `/quicknote`. The web
side already listens for `bkemo:quick-capture` (`pages/bkemo/index.tsx`), so the
remaining work is the native extension/intent — tracked as a follow-up.

## 6. Build / verify
- OTA bundle: `bun run build:web` → check `dist/public/app-bundle/{manifest.json,bundle-*.zip}`.
- iOS/macOS native builds, signing, offline-test recipes, device info: see `IOS.md` §4–6.
- Notifications: build the native app (`IOS.md` §5), grant permission, create a
  task due in ~2 min, background the app, confirm the banner fires.
