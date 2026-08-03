# Obsidian sidebar plugin plan

**Status:** O0 in progress

**Priority:** P1

**Confirmed:** 2026-08-01

**Started:** 2026-08-01 — pairing/device credentials, gateway filters/audio/attachment
contracts, `/api/v1/obsidian/*`, and `integrations/obsidian/` scaffold landed.
Disposable-vault interactive proof and production install remain gated.

**Goal:** provide a private bkemo client in Obsidian's right sidebar for
browsing, capturing, editing, and explicitly copying notes without silently
overwriting either system

## Product decision

Build a companion plugin under `integrations/obsidian/`. Version 1 is a native
Obsidian `ItemView`, not an embedded bkemo web page and not an automatic folder
mirror.

The plugin connects only to `https://bk.hax429.me`. It is released and tested
for desktop Obsidian, while its implementation remains compatible with mobile
Obsidian APIs where practical. It must not depend on Node, Electron, direct
filesystem access, or undocumented Obsidian Sync internals.

```text
Obsidian ItemView and Vault APIs
              |
              v
      bkemo companion plugin
              |
              v
  HTTPS and scoped device credential
              |
              v
       IntegrationGateway
              |
              v
   bkemo notes, tags, and files
```

The plugin has three deliberate data paths:

1. Remote operations read and update bkemo directly.
2. Save to vault creates or refreshes an ordinary Markdown file under a
   configurable `bkemo/` folder.
3. Append inserts Markdown at the active editor cursor with a small bkemo source
   link. Appended fragments are not independently synchronized.

## Confirmed scope

### Sidebar

The right sidebar provides:

- recent notes ordered consistently with bkemo;
- text search;
- filters for tasks, tags, and archived state;
- Markdown preview and attachment previews;
- direct editing of note content and inline hashtags;
- explicit save with visible dirty, saving, saved, and conflict states;
- typed capture and voice capture;
- refresh, Copy Markdown, Save to vault, Append to current note, and Open in
  bkemo actions.

The list and preview use native Obsidian controls and CSS variables. The plugin
registers a command and ribbon action to reveal the view. Network activity and
cache hydration begin after workspace layout is ready, not during plugin load.

### Typed capture

The compact composer accepts Markdown and creates a bkemo note directly. A
client-generated idempotency key makes retry safe. A queued offline capture is
shown immediately and submitted once connectivity returns.

### Voice capture

Voice capture uses the browser `MediaRecorder` surface without desktop-specific
APIs:

1. Start and stop recording from the sidebar.
2. Review the recorded audio, then submit or discard it.
3. Upload the audio through a bounded integration operation.
4. Create a bkemo note with the audio attachment and an idempotency key.
5. Let bkemo run its configured asynchronous transcription.
6. Refresh the note when the ordered change cursor reports the transcript.

The audio remains attached after transcription. Unsupported codecs, microphone
denial, recording limits, upload failure, and transcription failure have
separate messages. A failed transcription never deletes the recording.

### Remote editing

Sidebar editing sends the note portable ID, expected revision, new Markdown,
and an idempotency key. Inline hashtags remain bkemo's tag contract. A tag
picker may insert or remove hashtags, but the plugin does not invent a second
tag representation.

If the expected revision is stale, saving stops and opens a comparison between
the local draft and current bkemo content. There is no force overwrite action
in version 1.

### Copy Markdown

Copy Markdown places the original Markdown body on the system clipboard. It
does not add frontmatter or a source footer.

### Append to current note

Append inserts the Markdown body at the active editor cursor, followed by a
small source link to the bkemo note. It is available only for an editable
Markdown view and participates in the active editor's normal undo history.

### Save to vault

Save to vault writes under a configurable root that defaults to `bkemo/`. It
uses the Obsidian `Vault` and `FileManager` APIs and never writes outside the
normalized root.

A saved note uses this frontmatter contract:

```yaml
---
bkemo: 1
portableId: "67b2d411-221e-4dbe-98a4-d6db7c98c793"
revision: 42
source: "https://bk.hax429.me/..."
type: 2
createdAt: "2026-08-01T08:00:00.000Z"
updatedAt: "2026-08-01T08:10:00.000Z"
dueDate: null
completedAt: null
isImportant: false
isUrgent: true
isArchived: false
tags: [work]
contentHash: "sha256:..."
---
Write the report #work
```

The plugin preserves Markdown, tags, task metadata, source identity, revision,
and content hash. `portableId` is identity; the path is presentation. The
default path is deterministic:

```text
bkemo/YYYY/MM/<slug>--<portable-id-prefix>.md
```

When the portable ID already exists in the projection map, Save to vault opens
the existing file and offers Refresh from bkemo. It never silently creates a
duplicate or overwrites local changes.

### Explicit push from vault

Push current note to bkemo is a command for a saved projection file. It sends
the Markdown body and inline hashtags only after verifying the stored revision.
Task metadata remains preserved in frontmatter but is not pushed by this command
in version 1 unless a later, explicit task-field editor is approved.

On success, the command updates revision, updated time, and content hash through
`FileManager.processFrontMatter`. On revision mismatch it blocks the push and
shows both versions. It never force overwrites bkemo.

### Attachments

The sidebar previews remote attachments using authenticated requests. Save to
vault and Append do not download binaries automatically. An explicit Copy
attachment action stores a file under:

```text
bkemo/attachments/<note-portable-id>/<safe-name>
```

The plugin addresses attachments by portable ID, sanitizes display names, and
checks size and hash before replacement. Markdown never contains a bearer token.

## Authentication and authorization

Pair the plugin with a one-time code issued by bkemo. Exchange it for a
revocable device credential and store that credential with Obsidian
`SecretStorage`. Plugin data stores only the secret name.

The version 1 credential needs these effective capabilities:

- read notes and ordered note changes;
- create and conditionally update notes;
- read the tag tree;
- read attachments;
- upload an audio or explicitly copied attachment.

Tag changes happen through guarded note content updates. Global tag rename,
delete, reorder, and icon management remain outside the plugin. Destructive
note actions, sharing, comments, account administration, AI configuration, and
unrestricted file management are not granted.

Revocation must fail on the next request. Logs and diagnostics may contain the
fixed server origin, cursor, counts, relative vault paths, response codes, and
redacted errors, but never credentials, recording contents, or note bodies.

## Server contract work

Reuse `server/lib/integrationGateway.ts` rather than calling Prisma or broad
tRPC procedures from the plugin. Existing search, get, change cursor, create,
conditional update, and attachment read behavior form the base.

Add or tighten these bounded contracts before plugin implementation:

1. One-time pairing code issuance, exchange, expiry, revocation, and audit.
2. Sidebar query filters for task, tag, and archived state with deterministic
   pagination.
3. Audio upload with MIME allowlist, size limit, duration limit, ownership, and
   stable attachment identity.
4. Create note with an uploaded attachment through the gateway.
5. Authenticated attachment metadata and content reads by portable ID.
6. A source URL format that opens the matching note in bkemo.
7. Redacted, normalized errors for offline, unauthorized, conflict, invalid
   media, oversized media, and unavailable transcription cases.

The existing note update path already derives tags from inline hashtags.
Version 1 should not use the broad tag mutation routes merely to edit a note's
tags.

## Plugin implementation shape

```text
integrations/obsidian/
  manifest.json
  package.json
  tsconfig.json
  esbuild.config.mjs
  styles.css
  src/
    main.ts
    settings.ts
    pairing.ts
    bkemoClient.ts
    types.ts
    view/
      BkemoSidebarView.ts
      noteList.ts
      notePreview.ts
      editor.ts
      capture.ts
      recorder.ts
      conflictModal.ts
    vault/
      projection.ts
      frontmatter.ts
      append.ts
      attachments.ts
    sync/
      cache.ts
      outbox.ts
      changes.ts
    diagnostics.ts
```

Keep the principal interfaces small:

```ts
interface BkemoClient {
  search(input: SearchInput): Promise<NotePage>;
  getNote(portableId: string): Promise<BkemoNote>;
  createNote(input: CreateNoteInput): Promise<BkemoNote>;
  updateNote(input: ConditionalUpdateInput): Promise<BkemoNote>;
  uploadAudio(input: AudioUploadInput): Promise<BkemoAttachment>;
  readChanges(cursor: number): Promise<ChangeBatch>;
}

interface ProjectionService {
  save(note: BkemoNote): Promise<ProjectionResult>;
  refresh(note: BkemoNote): Promise<ProjectionResult>;
  push(file: TFile): Promise<PushResult>;
  append(note: BkemoNote, editor: Editor): void;
}
```

HTTP, vault, cache, and recording details remain internal adapters. Test the
domain logic with fake clients and an in-memory vault adapter.

## Offline model

Cache only notes the user has loaded, plus the bounded recent list. The cache
may contain note bodies, so settings must explain that plugin data is local
vault data and provide Clear cached bkemo data.

Store JSON cache metadata through the plugin data API. Store queued audio bytes
in a bounded IndexedDB adapter rather than serializing blobs into `data.json`.
Keep this adapter behind the cache interface so a later mobile release can
replace it without changing capture logic.

The outbox accepts only new typed or voice captures. It does not queue edits to
existing notes because their revisions may change while offline. Each queued
capture stores an idempotency key, created time, payload state, and retry state.
Audio blobs have a strict total size limit and are removed after confirmed
creation or explicit discard.

When connectivity returns, replay the outbox in order. Authentication failure
stops replay; transient failures use bounded backoff; permanent validation
failures remain visible for manual correction.

## Phases

### O0: contract and disposable prototype

- Create a throwaway Obsidian vault.
- Scaffold from the official sample plugin under `integrations/obsidian/`.
- Prove right-sidebar activation, SecretStorage pairing, authenticated request,
  Markdown rendering, editor insertion, MediaRecorder support, and clean unload.
- Add gateway contract tests for pairing, filtering, audio upload, attachment
  ownership, conditional updates, and redacted errors.
- Do not connect to production during this phase.

### O1: read sidebar

- Implement recent notes, search, task/tag/archive filters, preview, refresh,
  attachment preview, and Open in bkemo.
- Add bounded cache hydration after layout readiness.
- Verify restart behavior and credential revocation.

### O2: capture and copy

- Add typed capture with idempotent creation.
- Add reviewed voice recording, upload, note creation, and asynchronous
  transcription refresh.
- Add Copy Markdown, Append to current note, Save to vault, projection mapping,
  and explicit attachment copying.
- Add offline capture outbox and cache clearing.

### O3: guarded editing

- Add sidebar content and hashtag editing with expected revisions.
- Add Push current note to bkemo for projected files.
- Add local dirty detection, remote dirty detection, blocked pushes, and the
  comparison modal.
- Update projection metadata only after confirmed writes.

### O4: hardening and private release

- Complete security, path traversal, media limit, and retry tests.
- Verify command palette, ribbon, view persistence, settings persistence,
  deferred view behavior, reload, and clean unload.
- Test current supported desktop Obsidian versions on macOS.
- Produce `main.js`, `manifest.json`, and `styles.css` for private installation.
- Install in the real vault only after disposable-vault acceptance passes.

## Verification matrix

### Server

- Pairing codes are single use, short lived, account scoped, and audited.
- Revoked credentials stop immediately.
- Note and attachment reads cannot cross accounts.
- Replayed create and upload requests do not duplicate data.
- Stale revisions return conflict without mutation.
- Audio type, size, duration, and ownership limits fail safely.
- Transcription failure retains the original attachment.

### Plugin logic

- Search and filters return deterministic results.
- Copy Markdown preserves the body exactly.
- Append occurs at the cursor and participates in undo.
- Save to vault stays inside the configured root.
- Repeated save opens the existing portable ID projection.
- Refresh never overwrites a locally changed projection silently.
- Push never proceeds on a stale revision.
- Inline hashtag edits round trip without a second tag model.
- Offline captures replay once and retain actionable failures.

### Interactive desktop

- Enable, disable, reload, and uninstall leave no listeners or timers behind.
- The right sidebar restores without blocking Obsidian startup.
- Pairing survives restart without exposing the credential in plugin data.
- Microphone denial, audio review, discard, upload, and transcription refresh
  are understandable.
- Dark and light themes, narrow sidebar widths, keyboard navigation, focus, and
  screen reader labels remain usable.
- Large notes and long lists do not freeze the workspace.

## Explicit non-goals for version 1

- Automatic folder mirroring.
- Automatic two-way synchronization.
- Background sync while Obsidian is closed.
- Force overwrite after a revision conflict.
- Remote deletion, archive, restore, or task completion.
- Global tag administration.
- Automatic attachment download.
- Obsidian Sync as a bkemo transport.
- Community plugin submission.
- Mobile release testing or support commitment.
- Configurable server origin.

## Completion gate

Version 1 is complete only when the disposable vault passes the full interactive
desktop matrix, the server integration tests pass, private release assets build,
and no production connection, deployment, release, or real-vault installation
has occurred without separate user approval.
