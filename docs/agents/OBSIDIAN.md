# Obsidian companion guide

## Current status

O0 is in progress. Server pairing/device credentials and bounded gateway
operations exist. The private plugin scaffold lives at
`integrations/obsidian/`. Do not install into a real vault or connect to
production without separate approval.

## Server contract

- Connect with either:
  - a scoped access token from Settings → Security (validated at
    `POST /api/v1/obsidian/pair/access-token`, then used as the Bearer credential), or
  - a one-time pairing code (`obsidian.issuePairingCode` →
    `POST /api/v1/obsidian/pair/exchange`) that becomes a revocable device credential.
- Authenticated companion routes live under `/api/v1/obsidian/*` and call
  `IntegrationGateway`. `resolveObsidianActor` accepts device credentials and
  access-token JWTs.
- Required scope to connect: `notes:read`. Recommended:
  `notes:read`, `notes:write`, `tags:read`, `attachments:read`,
  `attachments:write`.
- Note source URLs use `https://bk.hax429.me/note/{portableId}`.
- Errors are redacted (`unauthorized`, `revision_conflict`, `invalid_media`,
  `oversized_media`, pairing failures, etc.).

## Publishable plugin package

```bash
./scripts/build_ob.sh
```

Stages `dist/obsidian/bkemo/{main.js,manifest.json,styles.css}` and
`dist/obsidian/bkemo-<version>.zip` for private Obsidian install. Production
builds always target `https://bk.hax429.me`.

Useful flags: `--clean`, `--install <vault>`, `--disposable`, `--open`,
`--dev-origin http://localhost:1111` (local testing only).

## Local disposable testing

1. Run local bkemo on `http://localhost:1111`.
2. Apply the pairing migration.
3. `./scripts/build_ob.sh --dev-origin http://localhost:1111 --disposable`
4. Open `integrations/obsidian/.disposable-vault` in Obsidian and enable bkemo.

See [`agents/plan/obsidian-integration.md`](../../agents/plan/obsidian-integration.md)
for phases O1–O4.
