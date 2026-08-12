# Obsidian companion guide

## Current status

The private **como** Obsidian plugin (`id: como`) now lives in a standalone
repository: [hax429/como](https://github.com/hax429/como) at
`~/Developer/como`. This document covers the **bkemo server** pairing contract
and how to exercise it locally. Plugin product shape, Activity, build/install,
and disposable vault testing are documented in the como repo
(`docs/OBSIDIAN.md`).

Do not install a production-origin como build into a real vault or connect to
production until the disposable acceptance checklist in the como repo passes
and you explicitly approve that step.

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
- Task helpers: create/update accept `task` / `dueDate` / `important` /
  `urgent`; complete via `POST /api/v1/obsidian/notes/:portableId/complete`
  (`done`, `expectedRevision`, `idempotencyKey`).
- Errors are redacted (`unauthorized`, `revision_conflict`, `invalid_media`,
  `oversized_media`, access-token failures, etc.).
- Security misuse alerts: minimal redirect copy in plugin settings; revoke /
  dismiss only on Mac or Web.

## Plugin development

```bash
cd ~/Developer/como
bun install
./scripts/build.sh --dev
```

Production package / primary vault install:

```bash
cd ~/Developer/como
./scripts/build.sh
./scripts/build.sh --install-primary   # after explicit approval
```

Local disposable testing still needs a running bkemo on
`http://localhost:1111` with the pairing migration applied.

See [`../plans/obsidian-integration.md`](../plans/obsidian-integration.md)
for phase history and non-goals.
