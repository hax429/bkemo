# URL bookmark enrichment (quick capture / TipTap)

**Status:** implemented (v1)

**Sibling of** [PARSING.md](./PARSING.md) (attachment → Markdown). This plan is
**URL → bookmark card + Defuddle Markdown + Wayback archive**.

## Locked product decisions

- Every TipTap editor (stream, modal, quicknote / mac).
- Bare `http(s)` and `www.` URLs become bookmark cards; text before/after stays.
- Explicit markdown links `[title](url)` are left alone.
- Conversion on whitespace after a URL; never inside code.
- Unlimited cheap cards (unfurl preview); Defuddle + Archive enrich ≤5 URLs per save.
- Paste/type = unfurl for the card; Defuddle + Archive run **after successful save** in the background.
- Defuddle runs **on the bkemo server** (`defuddle/node` + linkedom), not the Defuddle SaaS.
- Expand overlay (web/mac): tabs **Link** (default) / **Markdown** (TipTap) / **Archive**.
- Markdown tab is an editable sidecar; Insert into note is explicit.
- Archive uses Internet Archive Save Page Now 2 (`IA_S3_ACCESS_KEY` / `IA_S3_SECRET_KEY`).
- Skip **entire** enrichment for private/intranet/localhost and clearly-API URLs.
- Settings: master toggle + Markdown + Archive sub-toggles (Preferences → Link bookmarks).
- Obsidian: dialog → Live/Archive open Obsidian built-in browser on a **main** tab; Markdown in dialog.
- iOS: plain blue URL → Live / Archive → system browser (no in-app expand).

## Storage

- Note body keeps a **bare URL line** (markdown-friendly for iOS/Obsidian).
- Sidecar table `linkEnrichment` holds title, description, image, Defuddle markdown, archive URL, statuses.

## Key code

| Area | Path |
|---|---|
| URL helpers | `shared/lib/linkUrls.ts` |
| Enrichment service | `server/lib/linkEnrichment/` |
| tRPC | `server/routerTrpc/linkEnrichment.ts` |
| Obsidian REST | `GET /api/v1/obsidian/link-enrichments` |
| TipTap node | `app/src/components/TiptapEditor/bookmarkExtension.ts` |
| Expand UI | `app/src/components/TiptapEditor/BookmarkExpandOverlay.tsx` |
| Migration | `prisma/migrations/20260808100000_link_enrichment/` |

## Env

```bash
IA_S3_ACCESS_KEY=...
IA_S3_SECRET_KEY=...
```

Never commit these keys. Rotate any key that was pasted into chat.

## Verify

1. Paste `https://example.com` into composer → bookmark card with title/excerpt/image.
2. Save memo → Markdown and Archive tabs fill (or show Retry).
3. Private/`/api/` URLs are skipped.
4. Obsidian: tap link → dialog → Live opens main-window webviewer.
5. iOS: blue URL → Live / Archive → Safari.
