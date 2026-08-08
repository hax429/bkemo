# Obsidian companion guide

## Current status

**como** is the combined Obsidian companion under `out/obsidian/` — bkemo notes
sidebar + Codian AI chat in one plugin (`id: como`). Modes switch via
double-click on the in-view brand title (bkemo ↔ Codian). Settings use a shared tab bar (**Notes · Chat · Providers**). In-view brand is
always **como**; double-click / chevron switches **Notes** ↔ **Chat**.

O4 private-release hardening continues for the **no-projection** bkemo v1 path:
read sidebar, capture, append/copy markdown, explicit Copy attachment, offline
outbox, guarded dock editing, and command palette actions. Local vault
projection remains out of v1.

Do not install a production-origin build into a real vault or connect to
production until the disposable acceptance checklist below passes and you
explicitly approve that step.

## Product shape (v1)

- Right sidebar feed + bottom multifunctional dock (capture / preview / edit)
- Single-click select → dock preview + actions; double-click → dock editor
- Double-click brand title → switch between Notes and Chat (same leaf)
- Copy Markdown, Append to active note, Open in bkemo, Copy attachment to vault
- Command palette:
  - Open como (active mode)
  - Switch como mode
  - Create new bkemo note (opens list + focuses capture)
  - Append selected bkemo note
  - Copy selected bkemo note markdown
  - Copy attachment from selected bkemo note
  - Codian chat commands (open view, inline edit, tabs, …)
- Desktop-only (`isDesktopOnly: true`)
- Disconnect clears **local** SecretStorage only; revoke tokens in bkemo
  Settings → Security

## Server contract

- Connect with a **platform-bound access token** (`platform: obsidian`) from
  Settings → Security (validated at `POST /api/v1/obsidian/pair/access-token`,
  then used as the Bearer credential). Pairing codes and device credentials are
  retired — every Obsidian install must create a new token.
- Authenticated companion routes live under `/api/v1/obsidian/*` and call
  `IntegrationGateway`. `resolveObsidianActor` accepts access-token JWTs only.
  Clients send `X-Bkemo-Platform: obsidian`.
- Required scope to connect: `notes:read`. Recommended:
  `notes:read`, `notes:write`, `tags:read`, `attachments:read`,
  `attachments:write`.
- Note source URLs use `https://bk.hax429.me/note/{portableId}`.
- Errors are redacted (`unauthorized`, `revision_conflict`, `invalid_media`,
  `oversized_media`, access-token failures, etc.).
- Security misuse alerts: minimal redirect copy in plugin settings; revoke /
  dismiss only on Mac or Web.

## Publishable plugin package

```bash
./scripts/build_ob.sh
```

Stages `out/output/obsidian/como/{main.js,manifest.json,styles.css}`
and `out/output/obsidian/como-<version>.zip` for private Obsidian
install. Production builds always target `https://bk.hax429.me`.

Useful flags: `--dev`, `--clean`, `--install <vault>`, `--install-primary`,
`--disposable`, `--open`, and `--dev-origin <url>` (non-default local origin).

Use `./scripts/build_ob.sh --install-primary` to build the production plugin,
replace `main.js`, `manifest.json`, and `styles.css` under
`~/hax429/.obsidian/plugins/como`, and verify every installed file matches the
published build. This preserves plugin `data.json`.

Use `./scripts/build_ob.sh --dev` for normal local development. It builds for
`http://localhost:1111`, installs into `~/hax429/.obsidian/plugins/como` and
`out/obsidian/.disposable-vault/.obsidian/plugins/como`, preserves `data.json`,
and verifies primary-vault file parity. Reload Obsidian after it completes.

Sources live together under `out/obsidian/src/` (bkemo companion +
`src/codian/` for Codian). `res/codian-main` is only an upstream vendor mirror.

Legacy `bkemo` / `codianz` / `codian` plugin data is migrated into `como` on
first load when como’s `data.json` is empty.

## Local disposable testing

1. Run local bkemo on `http://localhost:1111`.
2. Apply the pairing migration.
3. `./scripts/build_ob.sh --dev`
4. Open `out/obsidian/.disposable-vault` (or `~/hax429`) in Obsidian and enable
   **como**.

### Disposable acceptance checklist (sign off before prod install)

- [ ] Enable plugin; sidebar restores without blocking Obsidian startup
- [ ] Pair with Obsidian access token; Test session succeeds
- [ ] Search / tag / task / archive filters return expected notes
- [ ] Single-click select shows dock preview once (no duplicate title)
- [ ] Copy Markdown / Append / Open in bkemo work from the dock
- [ ] Copy attachment writes under `bkemo/attachments/<note-id>/…`
- [ ] Typed capture + voice capture (review / discard / upload)
- [ ] Offline typed capture queues and replays after reconnect
- [ ] Double-click edit → blur/Esc save; conflict modal reload vs keep editing
- [ ] Double-click brand title → switch to Codian; switch back to bkemo
- [ ] Settings → como shows Bkemo + Codian tabs
- [ ] Command palette: Open como, Switch mode, Create note, Append, Copy…
- [ ] Disable / reload / unload leaves no stuck overlays or obvious timer noise
- [ ] Disconnect clears local credential; revoked token fails on next request
- [ ] Dark + light themes, narrow sidebar width remain usable

After this checklist passes, build production origin with
`./scripts/build_ob.sh` (no `--dev-origin`) and only then
`--install-primary` with explicit approval.

See [`../plans/obsidian-integration.md`](../plans/obsidian-integration.md)
for phase history and non-goals.
