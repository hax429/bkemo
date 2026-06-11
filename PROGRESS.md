# bkemo — Progress Log

Reverse-chronological record of work blocks. See per-area docs for detail:
[`WORKFLOW.md`](./WORKFLOW.md) · [`IOS.md`](./IOS.md) · [`MAC.md`](./MAC.md) ·
[`MCP.md`](./MCP.md) · [`MOBILE_CLIENT_DESIGN.md`](./MOBILE_CLIENT_DESIGN.md).

---

## 2026-06-11 — Phase 8 OTA + tests + docs + share/login theming

**Status: all uncommitted in the working tree.** Verified locally; not yet
committed/pushed/deployed (awaiting "ship it" per WORKFLOW.md).

### iOS Phase 8 — OTA frontend updater (native Rust, landed *behind* baseline)
- `app/src-tauri/Cargo.toml` — added `zip`, `sha2`, `reqwest` (rustls).
- `app/src-tauri/src/bundle_resolver.rs` (new) — resolve request → file in active
  bundle, mime map, atomic `bundle-state.json`, path-traversal guard + unit tests.
- `app/src-tauri/src/bundle_updater.rs` (new) — fetch manifest → SHA-256 verify →
  extract → flip pointer → prune; min-native warning event + unit tests.
- `app/src-tauri/src/lib.rs` — register `bundle://` scheme (mobile) + spawn updater
  in `setup()`. **Window URL still `tauri://localhost`** — one-line flip pending an
  on-device test.
- Verified: `cargo check` (desktop + `aarch64-apple-ios-sim`) and `cargo test` (6/6).

### Phase 6 — tests
- `app/vitest.config.ts` + `test`/`test:watch` scripts; `vitest`+`jsdom` devDeps.
- `taskNotifications.test.ts` (4) + `blinkoEndpoint.test.ts` (4) — **8/8 pass**.
- Rust `#[cfg(test)]` units in the bundle modules.

### Notifications (wired earlier; needs native rebuild to activate)
- `tauri-plugin-notification` in Cargo + `lib.rs`; `notification:default` capability;
  `app/src/lib/taskNotifications.ts` + Settings toggle + scheduling effect.

### Docs
- New: `WORKFLOW.md` (dev→test→ship loop + real Oracle topology), `MAC.md`
  (native macOS + Quick Note plan), `MCP.md` (MCP server over the REST API).
- Updated: `CLAUDE.md` (workflow/deploy + roadmap; refreshed iOS/macOS paragraph),
  `IOS.md` (Phase 8/6 status, native direction, cross-refs), `MOBILE_CLIENT_DESIGN.md`.
- Memory: `deploy-workflow`, `mobile-native-direction`.

### Bug fixes — public share page + auth backgrounds
- **Share attachments** (`app/src/pages/m/[id].tsx`) — backend already returned
  `attachments`; the page never rendered them. Added `AttachmentList` + the type
  field. (`file.ts` serves shared-note files to guests with no token.)
- **Themed dynamic background** (`app/src/components/Common/GradientBackground.tsx`)
  — was hardcoded Blinko colors; `ShaderGradient` ignores `color1/2/3` props in
  static use. Now builds a `control='query'` **urlString from the user's accent +
  theme** (`loadPrefs()`), so signin/signup/share gradients track Settings →
  Appearance. Share page reads prefs and lets the shader show through (was hidden
  by the opaque `.bkemo` background).
- **Readability** — added a dark/light **scrim** over the gradient (mutes bright
  accents like amber) + raised the share memo card / composer opacity (~0.72–0.78)
  with blur.

### Environment
- Local dev server running via `./run-dev.sh` on `http://localhost:1111`.
- iOS sim build blocked on `sudo xcode-select -s /Applications/Xcode.app` (CLT was
  active; user must run the one-time switch).

### Next up (recommended order)
1. Ship this block (commit + push + deploy) once the share/login look is confirmed.
2. `xcode-select` switch → `./build_ios.sh --sim` → on-device offline + OTA test →
   flip iOS window URL to `bundle://localhost`.
3. macOS Quick Note (MAC.md Q1–Q4).
4. Activate notifications (native rebuild) + macOS signing/TestFlight.
5. MCP server (MCP.md M1–M4).
