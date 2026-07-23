# bkemo AI and Discovery Implementation Plan

This plan describes the intended clean AI framework for bkemo. It is written as an implementation handoff for a model or engineer that does not have the original discussion context.

## Locked decisions (2026-07-22 grill)

| # | Decision | Choice |
|---|---|---|
| 1 | Primary job | Insight / reflection partner; RAG Q&A is supporting |
| 2 | Ship order | Global + per-card first; Analytics polish next (backend/UI already started) |
| 3 | Settings → AI restyle | Same effort |
| 4 | Global default mode | Insight-first system prompt + RAG |
| 5 | Global conversations | Multiple threads |
| 6 | Save as bkemo | Selected assistant message; optional include-question later |
| 7 | Missing embeddings | **Hard block all AI** until embedding model is configured and usable |
| 8 | Per-card storage | `conversation` / `message` with `scope=note`; display comment-like |
| 9 | Per-card threads | One thread per note (v1) |
| 10 | Mentions | Exact `@bk-<id>` + note picker UI |
| 11 | Per-card context | Current note + metadata + attachment metadata/text when available |
| 12 | Per-card RAG escalate | Never in v1 — only current note + explicit `@` refs |
| 13 | Discovery ranges | `3m` / `1y` / `all` |
| 14 | Over budget | Hard cap + transparent count; prefer recent + tag diversity when truncating |
| 15 | Prompt editability | Built-in constants only in v1 |
| 16 | Discovery persistence | Auto-save as `analytics` conversation; Save as bkemo is explicit |
| 17 | Discovery follow-up | Result becomes a conversation the user can continue |
| 18 | Attachments | Extracted text when available; else metadata |
| 19 | Global retrieval | Hybrid: RAG + recent notes + explicit `@` refs |
| 20 | Share AI history default | Off |
| 21 | Shared payload | Only that note’s AI messages; never leak `@`-referenced note bodies |
| 22 | Offline AI | Block with needs-network/model message |
| 23 | Note delete | Cascade note-scoped conversations |
| 24 | Global entry | Sidebar AI → full chat screen |
| 25 | Streaming | Chat streams; discovery may be non-stream first |
| 26 | Language | Discovery prompts force English; global/per-card follow user language |
| 27 | Plan base | This document |
| 28 | Next step after grill | Update plan first; implement after user confirms |

### Hard gate (decision 7)

AI surfaces must refuse to run unless **both** are ready:

1. Main chat / inference model configured (`mainModelReady`)
2. Embedding-capable model configured (`embeddingModelReady` / `embeddingFeatureReady`)

UI should show a setup state that links to Settings → AI and explains that embeddings are required for note-backed AI. Do not silently degrade to no-context chat.

Also require a rebuilt embedding index before promising full-corpus RAG quality; if the index is empty/stale, show a clear “rebuild embeddings” CTA rather than pretending retrieval works.

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
- Do not allow AI chat without embeddings (override of earlier soft-degrade copy).

## Current state (as of plan update)

Already present in the repo:

- `conversation.scope` / `noteId`, `message` table, cascade on note delete
- `server/lib/aiConversation.ts`, `server/lib/aiDiscovery.ts`, `server/lib/aiConfigStatus.ts`
- tRPC `ai.conversationStream`, `ai.discover`, embedding rebuild endpoints
- `AIScreen` + `AIThread` / `NoteAIThread` with `@bk-<id>` parsing
- Analytics AI discovery panel (range + value/default buttons)
- Settings → AI provider/model UI (needs remaining bkemo restyle polish)

Known gaps / required fixes before calling this done:

1. Enforce embedding hard-block in chat + discovery + UI copy (currently chat can run with `withRAG=false` if embeddings missing; settings copy still says embedding is optional for plain chat).
2. Replace abbreviated discovery prompts in `server/lib/aiDiscovery.ts` with the full Value / Default prompts from this plan.
3. Persist discovery results as `scope=analytics` conversations and allow follow-up chat.
4. Per-card: note picker for `@` mentions; comment-like labeling; ensure one thread per note.
5. Share flow: include-AI-history toggle default off; public share must honor it.
6. Hybrid global retrieval (RAG + recent + explicit refs) and transparent source chips.
7. Attachment text extraction path via existing attachment service (graceful degrade).
8. Finish Settings → AI dialog restyle and sidebar tag density if still incomplete.

## Product behavior

### 1. Global AI chat

Navigation:

- The sidebar AI item opens a global AI conversation screen.
- Full-screen chat using bkemo visual language: dark paper surface, soft borders, amber accent, compact density.

Behavior:

- Insight-partner default; still answers factual note questions via RAG.
- Uses configured main chat model from Settings → AI.
- Requires embedding model; block with setup CTA if missing.
- Hybrid retrieval: embeddings RAG + recent notes + explicit `@bk-*` refs.
- Notes from Neon; attachments via storage-agnostic attachment service (local or S3/R2).
- Stream responses.
- Multiple persisted threads.
- Save selected assistant response as a new bkemo (include source `BK-` links when present).

Suggested UI:

- Left conversation list.
- Main chat transcript.
- Composer fixed near the bottom.
- Source/reference chips below assistant replies.
- “Save as bkemo” on assistant replies.

### 2. Per-card AI chat

Location in note detail:

1. Note details/content
2. Subtasks
3. Comments (if any)
4. AI conversation history (comment-like, clearly labeled User / AI)
5. Per-card AI composer

Behavior:

- Default context: current card only.
- Add context with `@bk-<id>` and a note picker.
- Persist in `conversation`/`message` with `scope=note`, one thread per note.
- Clearly mark `user` and `assistant` roles in UI.
- No global RAG escalation in v1.
- Same Settings → AI models; embedding hard-block applies.
- Attachments: metadata + extracted text when available.

### 3. AI analytics discovery

Location: Analytics → AI Analytics section.

Controls:

- Range: recent 3 months / recent year / all notes
- Value discover
- Default discover

Behavior:

- Feed selected notes + built-in prompt (full text below).
- Cap included notes; show count and range used.
- Persist as `analytics` conversation; allow follow-up.
- Copy / Save as bkemo.
- Account ownership only.
- English output per prompts.

## Required prompts

Use these full strings as built-in constants (not user-editable in v1).

### Value prompt

```
You are a thoughtful analytical partner specializing in values clarification. Study the user’s notes to uncover the values, needs, and tradeoffs beneath their choices, emotional reactions, recurring interests, and personal reflections.

This is not an advice-giving task. Do not tell the user what they should do or prescribe a solution. Your purpose is to help them recognize what already appears to matter to them, especially when their stated priorities and lived behavior do not fully align.

Use the following framework internally:

Explicit values Identify values the user directly names, endorses, or deliberately pursues.
Implicit values Infer what matters from where the user invests attention, effort, emotion, or responsibility—even when they never name that value directly.
Conflicting values Find values that pull the user in different directions, such as autonomy versus belonging, achievement versus exploration, control versus acceptance, or efficiency versus authenticity.
Misaligned values Look for gaps between:
what the user says matters and what receives their energy;
what they pursue and what actually brings satisfaction;
the standards they use to judge themselves and the experiences they describe as meaningful.
Core values Identify the one or two values that appear repeatedly across different situations and seem to organize many of the user’s choices.
Reasoning process:

Review the notes for meaningful decisions, emotional shifts, repeated concerns, moments of pride, disappointment, resistance, relief, and responsibility.
Pay special attention to changes in perspective. A movement from resistance to appreciation, or from external expectations to personal meaning, often reveals an underlying value.
Compare what the user admires in other people or environments with what they seek in their own life.
Notice what they attempt to protect, repair, organize, or take responsibility for.
Generate several candidate interpretations before selecting the strongest one.
Distinguish values from skills. For example, repeated problem-solving may reflect not only technical ability but also a need for agency, competence, certainty, service, or control.
Distinguish evidence from interpretation. Present inferred values as possibilities rather than definitive psychological facts.
Output requirements:

Write in English.
Address the user as “you.”
Use a warm, perceptive, and gently incisive tone.
Do not mention or infer identity, nationality, age, education level, diagnosis, or personal background unless it is strictly necessary and explicitly established by the supplied notes.
Do not provide direct advice, action plans, or instructions.
Do not simply summarize the notes.
Avoid generic encouragement and personality labels.
Do not rely on lengthy quotations. Paraphrase the evidence in your own words.
Preserve references such as MEMO when useful, while paraphrasing rather than quoting.
Focus on the meaning beneath the examples, not on cataloguing every topic in the notes.
Structure the response around:

The central value pattern you observe.
The strongest implicit value revealed by the user’s behavior.
The main conflict between two important values.
A possible misalignment between external standards and internal sources of meaning.
The core value—or combination of values—that best explains the recurring pattern.
One or two open questions that invite further self-discovery without steering the user toward a predetermined answer.
Aim for a conclusion that clarifies a tension rather than resolving it
```

### Default prompt

```
You are an insightful analytical partner. Study the user’s notes and uncover a deep, counterintuitive, but well-supported insight about their thinking patterns, motivations, tensions, blind spots, or current direction.

Do not merely summarize the notes. Look beneath their apparent fragmentation to identify recurring patterns, hidden connections, productive contradictions, or assumptions the user may not recognize.

Use this reasoning process internally:

Understand the user’s current concerns, motivations, transitions, interests, and emotional pressures using only the supplied notes.
Generate several preliminary insights grounded in specific evidence.
Search for a deeper pattern that connects observations from different areas.
Identify a productive tension—especially a strength that may also create a blind spot.
Compare the candidate insights and select the one that is most surprising, relevant, useful, and strongly supported.
Apply this craft process:
Trace: collect recurring clues across the notes.
Distill: reduce them to one central tension or pattern.
Weave: connect examples from different notes into a coherent argument.
Anchor: support the conclusion with concrete experiences and note citations.
Important principles:

Treat the notes as evidence, not as a complete psychological profile.
Do not infer sensitive traits, demographic details, diagnoses, or personal history that the notes do not explicitly establish.
Distinguish clearly between evidence and interpretation.
Phrase uncertain conclusions as possibilities rather than facts.
Avoid generic encouragement, vague philosophy, clichés, and unsupported psychological claims.
Prefer one precise, useful insight over several broad observations.
Output requirements:

Write in English.
Present one primary insight that is counterintuitive, emotionally resonant, and practically useful.
Use a warm but incisive tone.
Open with a question, contrast, or surprising observation.
State the central claim early and clearly.
Support it with concrete examples from the notes.
Preserve source references such as bkemo when available.
Explain why the identified pattern is valuable and how it might also become limiting.
Include one small, specific action the user can take today.
Recommend one relevant book or resource.
Provide two useful search keywords for further exploration.
End with a concise, memorable sentence.
After the primary insight, provide two additional insights. For each one, include:

A compelling hook.
The core insight.
The evidence or reasoning supporting it.
Keep the response between 700 and 1,200 words. Use clear paragraphs and minimal formatting.
```

## Data model

Use existing tables:

- `Conversation.scope`: `global` | `note` | `analytics`
- `Conversation.noteId`: set for `note` scope
- `Conversation.title`
- `Message.role`: `user` | `assistant` | `system`
- `Message.metadata`: sources, token usage, discovery kind/range, etc.

Indexes already present / keep:

- `(accountId, scope)`
- `(noteId)`
- `(conversationId)` on messages

Rules:

- Every conversation/message belongs to an account.
- Per-card conversations readable only with parent note access.
- Deleting a note cascades note-scoped AI conversations.

## Backend API

### `ai.configStatus`

Return readiness without secrets:

- `mainModelReady`
- `embeddingModelReady` / `embeddingFeatureReady`
- titles / missing setup message

### `ai.conversationStream` (or equivalent)

Input: scope, conversationId?, noteId?, prompt, contextNoteIds?, withRAG?

Behavior:

1. Auth
2. **Require main + embedding models** (hard block)
3. Load/create conversation
4. Save user message
5. Build context (global hybrid vs note+refs)
6. Stream completions
7. Save assistant message + source metadata

### `ai.discover`

Input: `kind` (`value`|`default`), `range` (`3m`|`1y`|`all`)

Behavior:

1. Auth + hard model gate
2. Select notes in range, cap with transparent count
3. Run full built-in prompt
4. Persist analytics conversation + return result metadata

### Conversation list/detail

Filter by scope / noteId; chronological messages.

## Attachment handling

Storage-agnostic via existing attachment service:

- Prefer extracted text
- Else filename/type/note relationship
- Non-fatal omit on load failure

## Sync / offline

- Conversations/messages live in DB (Neon), not localStorage
- Offline: block AI with clear message
- Save-as-bkemo creates a normal note

## Sharing

- Toggle: include AI chat history (default **off**)
- If on: only that note’s AI messages, labeled User/AI
- Never include global/analytics threads, API config, system prompts, or `@`-referenced note bodies

## Frontend map

- `app/src/components/bkemo/AIScreen.tsx`
- `app/src/components/bkemo/ai/AIThread.tsx`
- `app/src/components/bkemo/NoteModal.tsx`
- `app/src/components/bkemo/Analytics.tsx`
- `app/src/components/bkemo/Sidebar.tsx`
- `app/src/pages/bkemo/index.tsx`
- `app/src/styles/bkemo-theme.css`
- Settings dialogs under `app/src/components/BlinkoSettings/AiSetting/`

## Security and privacy

- Authenticated AI routes only
- Never expose provider API keys to frontend
- Ownership checks on every note id / `@bk-*`
- Public share excludes AI history unless opted in
- Discovery uses only requesting account’s notes

## Setup guide: RAG and embedding models

This is the operator checklist for making note-backed AI work in bkemo.

### What RAG means here

1. Each note (and attachable text when available) is turned into vectors by an **embedding model**.
2. Those vectors are stored in the embedding index (rebuild job).
3. When you ask a question, bkemo embeds the query, retrieves the top matching notes (`embeddingTopK` / `embeddingScore`), and sends those notes plus your question to the **main chat model**.

Without steps 1–2, retrieval cannot work. Per the locked decision, AI features stay blocked until embeddings are configured.

### Prerequisites

- A provider API key (OpenAI, Anthropic, Google, Ollama, or custom OpenAI-compatible endpoint)
- Network access from the bkemo server to that provider
- Notes already in Neon (normal bkemo usage)

### Step-by-step in Settings → AI

1. **Add a provider**
   - Settings → AI → Add Provider
   - Enter base URL (if custom/Ollama) and API key
   - Save and confirm the provider appears

2. **Add a main chat (inference) model**
   - Add Model on that provider
   - Set model key (examples: `gpt-4.1`, `claude-sonnet-4`, `gemini-2.5-pro`, local chat model name for Ollama)
   - Enable **inference** capability
   - Run capability test if offered
   - In **Default Models**, set this as **Main Chat Model**

3. **Add an embedding model**
   - Add another model (same or different provider)
   - Set embedding model key (examples: `text-embedding-3-small`, `text-embedding-3-large`, `text-embedding-004`, or an Ollama embedding model)
   - Enable **embedding** capability
   - Confirm dimensions from the capability test when available; store them if the UI asks
   - In **Default Models**, set this as **Embedding Model**

4. **Tune retrieval (optional but recommended)**
   - Embedding Top K: how many notes to pull (default ~5)
   - Embedding score threshold: minimum similarity (default ~0.6)
   - Exclude tags from embedding if some notes should never enter RAG

5. **Rebuild the embedding index**
   - Settings → AI → Embedding → Rebuild embedding index
   - Wait until progress completes
   - Re-run after bulk imports or if answers ignore recent notes

6. **Verify readiness**
   - Setup overview should show Provider, Main chat, and Embedding as Ready
   - Open sidebar **AI** — setup CTA should disappear
   - Ask a question that only your notes can answer; expect source chips / `BK-` references
   - Run Analytics → Value discover or Default discover on a small range first

### Model pairing tips

| Role | Good choices | Notes |
|---|---|---|
| Main chat | Strong instruction-following chat model | Used for insight partner + discovery long-form output |
| Embedding | Dedicated embedding model from a major provider | Do not mark a chat-only model as embedding |
| Local/dev | Ollama chat + Ollama embedding model | Useful offline-ish; quality/speed vary |

Keep chat and embedding models separate even if the same vendor. Switching embedding models usually requires a **full rebuild** because vector dimensions/space change.

### Common failures

| Symptom | Likely cause | Fix |
|---|---|---|
| AI blocked / setup CTA | Missing main or embedding default | Set both under Default Models |
| Rebuild fails | Embedding capability false / bad key | Re-test model; fix API key/base URL |
| Answers ignore notes | Index empty or stale | Rebuild embeddings |
| Weak retrieval | Top K too low / score too high | Raise Top K or lower score threshold slightly |
| Discovery too generic | Range too wide / cap truncated meaning | Try 3 months first; check included note count |
| Provider errors on long discovery | Context too large | Rely on note cap; shorten range |

### Security notes for setup

- API keys stay on the server; the UI only shows config status
- Rebuild embeds note content — treat provider choice as a privacy decision
- Shared notes never include AI history unless the share toggle is on

## Implementation order

1. Enforce embedding hard-block across `aiConversation`, `aiDiscovery`, and frontend setup CTAs/copy
2. Replace discovery prompts with the full Value / Default strings
3. Persist analytics conversations + follow-up chat
4. Finish per-card UX (picker, labeling, one-thread guarantee)
5. Share include-AI-history toggle (default off)
6. Hybrid global retrieval + attachment text path
7. Settings → AI restyle / sidebar density polish
8. Build + smoke checks from verification checklist below

## Verification checklist

1. `git diff --check` passes
2. `bun run build:web` passes
3. Settings → AI: provider/model dialogs match bkemo; embedding required messaging is accurate
4. Without embedding model: Global AI, per-card AI, and discovery all blocked with setup CTA
5. With models + rebuilt index: global chat answers with sources; save as bkemo works
6. Per-card: default scope is current note; `@bk-*` works; User/AI labels clear
7. Analytics: value + default discover with range; count shown; save as bkemo; follow-up possible
8. Sharing: AI history off by default; when on, only that note’s AI messages
9. Offline: AI blocked clearly
10. Sync: conversations in DB; saved AI replies behave like normal notes

## Implementation notes (in progress)

Started after user confirmation (2026-07-22):

- Embedding hard-block enforced in chat/discovery/completions + UI copy
- Full Value/Default prompts landed in `server/lib/aiDiscovery.ts`
- Analytics discoveries persist as `scope=analytics` and support follow-up
- MCP Integration, MCP Client Servers, and AI Post Processing removed from Settings → AI UI (code kept for later)
- Tavily settings hidden; global-only `withOnline` plumbing retained for later restore
- Share menu supports include/exclude AI chat history (default off); public `/m/:id` renders labeled history when enabled
- Recommended SiliconFlow embedding: `BAAI/bge-m3` (default), `Qwen/Qwen3-Embedding-4B` as higher-quality option
