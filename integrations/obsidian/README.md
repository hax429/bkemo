# bkemo Obsidian companion

Private desktop sidebar plugin for browsing, capturing, and explicitly copying
notes from bkemo. See [`agents/plan/obsidian-integration.md`](../../agents/plan/obsidian-integration.md).

## O0 status

- Server contracts: pairing codes, device credentials, filtered note search,
  audio upload, attachment reads, redacted errors, `/note/{portableId}` source
  URLs.
- Plugin scaffold: right-sidebar `ItemView`, SecretStorage pairing, HTTP client,
  Markdown preview, Append, MediaRecorder review, deferred layout hydration.

## Publishable build

From the repo root:

```bash
./scripts/build_ob.sh
```

Outputs:

```text
dist/obsidian/bkemo/{main.js,manifest.json,styles.css}
dist/obsidian/bkemo-<version>.zip
```

Private install: unzip into `<vault>/.obsidian/plugins/`, then enable **bkemo**.

Local disposable testing (not publishable):

```bash
./scripts/build_ob.sh --dev-origin http://localhost:1111 --disposable
```

## Disposable vault

`integrations/obsidian/.disposable-vault` is a throwaway vault. Prefer
`--disposable` on the build script rather than copying into a real vault.

Enable the plugin in Obsidian, open the right sidebar via the ribbon or command
**Open sidebar**, then pair with a code from bkemo Settings → Security.

## Scripts

| Command | Purpose |
|---|---|
| `../../scripts/build_ob.sh` | Publishable package + zip |
| `bun run dev` | Watch rebuild |
| `bun run build` | Bundle only |
| `bun run test` | Domain logic tests |

Production builds omit `BKEMO_DEV_ORIGIN` and always use `https://bk.hax429.me`.
