# como Obsidian companion

Private desktop plugin combining **bkemo** notes and **Codian** AI chat under
one tree: `out/obsidian/src/` (companion) + `out/obsidian/src/codian/` (Codian).
See [`docs/agents/OBSIDIAN.md`](../../docs/agents/OBSIDIAN.md).

## Status

**como** — one plugin (`id: como`), mode switch via double-click on the brand
title, shared settings tab bar.

### Highlights

- Feed + bottom dock: capture / single-select preview / double-click edit
- Codian multi-provider chat (sources in `src/codian/`)
- Capture (typed + voice) with offline outbox
- Copy Markdown, Append, Copy attachment, Open in bkemo
- Desktop-only; local projection (Save to vault / push) is out of v1

## Publishable build

```bash
../../scripts/build_ob.sh
```

Local development (localhost + primary vault + disposable vault):

```bash
../../scripts/build_ob.sh --dev
```

## Scripts

| Command | Purpose |
|---|---|
| `../../scripts/build_ob.sh` | Publishable package + zip |
| `../../scripts/build_ob.sh --dev` | Localhost build + install primary & disposable |
| `bun run dev` | Watch rebuild |
| `bun run build` | CSS + bundle |
| `bun run test` | Domain logic tests |
