# bkemo AI and Discovery Implementation Plan

This plan describes the intended clean AI framework for bkemo. It is written as an implementation handoff for a model or engineer that does not have the original discussion context.

## Goal

Add AI to bkemo in a way that feels native to the bkemo app:

- Global AI chat, opened from the AI navigation item.
- Per-card AI chat in the memo detail view, scoped to that memo by default.
- AI analytics discovery in Analytics, including value discovery and default insight discovery.
- Conversation history persisted and synced consistently with the user’s configured storage mode.
- AI replies can be saved as new bkemos.
- Sharing can optionally include or exclude AI chat history.
- Existing Settings → AI provider/model configuration should control all AI features.

Also fix the project/tag sidebar spacing so more tags fit in the limited sidebar area.

## Non-goals

- Do not keep using old HeroUI-looking AI provider/model dialogs.
- Do not create a separate legacy `/bkemo` experience.
- Do not make AI require a hardcoded provider or environment key if the user configured providers in Settings → AI.
- Do not expose private notes, attachments, or AI history in public sharing unless explicitly selected.
- Do not read or leak API keys to the frontend. The frontend should only know provider/model display information and configuration status.

## Product behavior

### 1. Global AI chat

Navigation:

- The sidebar AI item opens a global AI conversation screen.
- The global screen should resemble a modern ChatGPT-style chat page, but use bkemo visual language: dark paper surface, soft borders, amber accent, compact density, and the same typography rhythm as the rest of the app.

Behavior:

- The user can ask questions about all notes and attachments.
- The AI should use the configured main chat model from Settings → AI.
- Retrieval should use the configured embedding model and embedding settings when available.
- If no model/key is configured, show a helpful setup state linking to Settings → AI.
- The AI may use notes stored in Neon and attachments stored locally or in S3, depending on the app’s storage configuration.
- Responses should stream where the existing AI service supports streaming.
- Each global conversation should be persisted.
- The user should be able to save an AI response as a new bkemo.

Suggested UI:

- Left conversation list.
- Main chat transcript.
- Composer fixed near the bottom of the chat panel.
- Source/reference chips below assistant replies when retrieval returns note references.
- “Save as bkemo” action on assistant replies.

### 2. Per-card AI chat

Location:

- In the note detail modal, below subtasks/comments/history area.
- The detail order should be:
  1. Note details/content.
  2. Subtasks.
  3. Comments, if shared comments exist or comments are enabled.
  4. Previous AI chat history, if any.
  5. Per-card AI chat composer.

Behavior:

- By default, this chat is scoped only to the current bkemo card.
- The user can add other bkemos to context with mentions such as `@bk-5`.
- User prompts and AI responses are saved as conversation records under the bkemo card.
- Records must clearly mark `user` and `ai`.
- Older history should display normally, like comments, not as a disconnected hidden log.
- The per-card chat should still use the configured Settings → AI main chat model.
- If the note has attachments, attachment metadata/content should be available to the AI when the backend can load it.

Mention behavior:

- Parse `@bk-<id>` or the app’s canonical bkemo reference format.
- Validate the current user can read every referenced note.
- Invalid or unauthorized references should be ignored or reported as unavailable without exposing whether a private note exists for another account.

### 3. AI analytics discovery

Location:

- Analytics screen should have an “AI Analytics” section.

Controls:

- Time range selector:
  - Recent 3 months.
  - Recent year.
  - All notes.
- Value discover button.
- Default discover button.
- Optional custom prompt field can be added later, but first implementation must include the two built-in prompts.

Behavior:

- “Value discover” feeds the selected notes and the value prompt.
- “Default discover” feeds the selected notes and the default insight prompt.
- The result should show note count and date range used.
- Result can be copied or saved as a new bkemo.
- The discovery job should respect account ownership and privacy.
- For very large datasets, cap the included notes and clearly tell the user how many notes were included.

## Required prompts

### Value prompt

You are a thoughtful analytical partner specializing in values clarification. Study the user’s notes to uncover the values, needs, and tradeoffs beneath their choices, emotional reactions, recurring interests, and personal reflections.

This is not an advice-giving task. Do not tell the user what they should do or prescribe a solution. Your purpose is to help them recognize what already appears to matter to them, especially when their stated priorities and lived behavior do not fully align.

Use the following framework internally:

1. Explicit values: identify values the user directly names, endorses, or deliberately pursues.
2. Implicit values: infer what matters from where the user invests attention, effort, emotion, or responsibility, even when they never name that value directly.
3. Conflicting values: find values that pull the user in different directions.
4. Misaligned values: look for gaps between what the user says matters and what receives energy, what they pursue and what brings satisfaction, and the standards they use to judge themselves versus experiences they describe as meaningful.
5. Core values: identify one or two values that appear repeatedly across situations and organize many choices.

Output requirements:

- Write in English.
- Address the user as “you.”
- Use a warm, perceptive, gently incisive tone.
- Do not mention or infer identity, nationality, age, education level, diagnosis, or personal background unless strictly necessary and explicitly established.
- Do not provide direct advice, action plans, or instructions.
- Do not simply summarize the notes.
- Avoid generic encouragement and personality labels.
- Distinguish evidence from interpretation.
- Present inferred values as possibilities rather than definitive facts.
- Preserve references such as MEMO or bkemo when useful, while paraphrasing rather than quoting.
- Aim for a conclusion that clarifies a tension rather than resolving it.

Structure the response around:

- The central value pattern observed.
- The strongest implicit value revealed by behavior.
- The main conflict between two important values.
- A possible misalignment between external standards and internal sources of meaning.
- The core value, or combination of values, that best explains the recurring pattern.
- One or two open questions for further self-discovery.

### Default prompt

You are an insightful analytical partner. Study the user’s notes and uncover a deep, counterintuitive, but well-supported insight about their thinking patterns, motivations, tensions, blind spots, or current direction.

Do not merely summarize the notes. Look beneath apparent fragmentation to identify recurring patterns, hidden connections, productive contradictions, or assumptions the user may not recognize.

Output requirements:

- Write in English.
- Present one primary insight that is counterintuitive, emotionally resonant, and practically useful.
- Use a warm but incisive tone.
- Open with a question, contrast, or surprising observation.
- State the central claim early and clearly.
- Support it with concrete examples from the notes.
- Preserve source references such as bkemo when available.
- Explain why the pattern is valuable and how it might also become limiting.
- Include one small, specific action the user can take today.
- Recommend one relevant book or resource.
- Provide two useful search keywords for further exploration.
- End with a concise, memorable sentence.
- After the primary insight, provide two additional insights. For each, include a compelling hook, the core insight, and evidence or reasoning.
- Keep the response between 700 and 1,200 words.

## Data model

Use the existing conversation/message tables if possible, but add enough structure to distinguish global chat from per-card chat.

Suggested Prisma changes:

- `Conversation.scope`: enum or string, values such as `global`, `note`, `analytics`.
- `Conversation.noteId`: nullable foreign key to `notes.id` for per-card chats.
- `Conversation.title`: optional generated title or first user message preview.
- `Conversation.metadata`: JSON for analytics range, discovery kind, selected model, sources, etc.
- `Message.role`: `user`, `assistant`, `system`, or equivalent existing roles.
- `Message.metadata`: JSON for source references, token usage, save status, etc.

Indexes:

- `(accountId, scope, updatedAt)`.
- `(accountId, noteId, updatedAt)`.
- `(conversationId, createdAt)`.

Rules:

- Every conversation and message must belong to an account.
- Per-card conversations must be readable only by users who can read the parent note.
- Deleting a note should either cascade its note-scoped AI conversations or leave them inaccessible according to existing data-retention policy. Prefer cascade only if current comments behave that way.

## Backend API

Add or clean up these tRPC endpoints:

### `ai.configStatus`

Returns whether AI can run:

- main chat model configured.
- embedding model configured.
- provider key/endpoint available.
- missing setup message.

Do not return secrets.

### `ai.chat`

Streaming mutation/subscription-style endpoint.

Input:

- `scope`: `global` or `note`.
- `conversationId?`.
- `noteId?` required for `note` scope.
- `prompt`.
- `contextNoteRefs?`: parsed or raw references such as `bk-5`.

Behavior:

1. Authenticate user.
2. Validate requested scope.
3. Load existing conversation or create a new one.
4. Save user message.
5. Build context:
   - global: retrieve from all notes/attachments allowed for account.
   - note: include current note first, then explicit `@bk-*` references.
6. Call `AiService.completions` or the repository’s canonical streaming abstraction.
7. Stream assistant deltas to frontend.
8. Save assistant message and source metadata after completion.

### `conversation.list`

Support filters:

- `scope`.
- `noteId`.
- pagination.

### `conversation.detail`

Return messages in stable chronological order.

### `ai.discover`

Input:

- `kind`: `value` or `default`.
- `range`: `3m`, `1y`, or `all`.
- `customPrompt?` reserved for later.

Behavior:

1. Authenticate user.
2. Select notes within range.
3. Cap maximum notes or token budget.
4. Include note IDs/references, timestamps, content summaries, and attachment names/content summaries when available.
5. Run the selected built-in prompt.
6. Return result text, selected note IDs, note count, and range metadata.

## Attachment handling

The AI layer should be storage-agnostic:

- Notes live in Postgres/Neon through Prisma.
- Attachments may live locally or in S3-compatible storage.
- The context builder should call the existing attachment service instead of constructing storage paths directly.
- Attachment text extraction should degrade gracefully:
  - If text extraction exists, include extracted text.
  - If only metadata is available, include filename, type, and note relationship.
  - If loading fails, omit the content and include a non-fatal warning in metadata.

## Sync behavior

If the user chooses Neon or local storage, AI conversation records must follow the same sync expectations as notes/comments.

Required:

- Conversation and message records are stored in the app database, not browser-only localStorage.
- Offline-created AI prompts should either be blocked with a clear “AI requires network/model access” message or queued only if the app already has a safe sync queue pattern for this.
- Once saved, conversation history should appear on other devices after normal sync.
- Saving an AI response as a bkemo must create a normal note, so it syncs exactly like other notes.

## Sharing behavior

When sharing a memo:

- Add an option: include AI chat history.
- Default should be off.
- If enabled, only include AI conversations attached to the shared note.
- Clearly label user and AI messages.
- Never include global AI conversations in a note share.
- Never include API configuration, provider metadata, hidden system prompts, or private retrieval context.

## Frontend implementation map

Suggested files:

- `app/src/components/bkemo/AIScreen.tsx`
  - Global AI screen wrapper.
- `app/src/components/bkemo/ai/AIThread.tsx`
  - Shared global/per-card chat component and hook.
- `app/src/components/bkemo/NoteModal.tsx`
  - Insert per-card AI chat below subtasks/comments/history.
- `app/src/components/bkemo/Analytics.tsx`
  - Add AI Analytics panel.
- `app/src/components/bkemo/Sidebar.tsx`
  - Add working AI route and tighten project/tag spacing.
- `app/src/pages/bkemo/index.tsx`
  - Route `ai` screen.
- `app/src/styles/bkemo-theme.css`
  - Native bkemo AI UI, dialog, chat, analytics, and compact project/tag spacing styles.

## Settings → AI cleanup

Provider/model dialogs must be restyled away from old HeroUI visuals.

Requirements:

- Use bkemo-native modal surfaces.
- Use simple native inputs/selects styled through bkemo CSS tokens.
- Add Provider and Add Model dialogs should match:
  - dark warm background.
  - rounded cards.
  - amber/green accent buttons.
  - compact spacing.
  - no purple HeroUI panel appearance.
- Default model configuration should show only configured model options.
- Rebuild embeddings should clearly explain it may take time.

## Security and privacy

- All AI routes require authenticated account context.
- Never expose provider API keys to frontend.
- All note IDs and `@bk-*` references must be ownership checked.
- Public share routes must not include AI history unless the share option explicitly allows it.
- Analytics discovery must use only the requesting account’s notes.
- Assistant prompts should avoid unsupported identity/personality/diagnosis inference.

## Verification checklist

Before marking done:

1. `git diff --check` passes.
2. `bun run build:web` passes.
3. Settings → AI:
   - Add Provider modal visually matches bkemo.
   - Add Model modal visually matches bkemo.
   - Global prompt, embedding management, post-processing, and tools sections have compact spacing.
4. Sidebar:
   - Project/tag rows use tighter line spacing and show more tags.
5. Global AI:
   - AI nav opens chat screen.
   - Missing configuration state is clear.
   - Configured model can answer.
   - Assistant response can be saved as a bkemo.
6. Per-card AI:
   - Chat appears below subtasks/comments/history.
   - User/AI messages persist.
   - `@bk-*` references work only when readable.
7. Analytics:
   - AI Analytics panel appears.
   - Value discover runs with selected range.
   - Default discover runs with selected range.
   - Result can be saved as a bkemo.
8. Sharing:
   - AI history is excluded by default.
   - If included, only current note AI history appears.
9. Sync:
   - Conversations/messages persist in DB.
   - Saved AI responses sync as normal notes.

## Implementation order

1. Clean dirty worktree and keep only AI-related/UI-spacing changes.
2. Add database fields for conversation scope and note binding.
3. Add backend AI conversation service.
4. Add backend AI discovery service.
5. Add tRPC endpoints and ownership guards.
6. Add global AI screen and route.
7. Add reusable AIThread component.
8. Add per-card AIThread to note detail.
9. Add AI Analytics panel.
10. Restyle Settings → AI dialogs and controls.
11. Tighten sidebar project/tag spacing.
12. Build and run smoke checks.
