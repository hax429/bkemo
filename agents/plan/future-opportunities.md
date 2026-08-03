# Future integration opportunities

**Status:** exploration backlog

**Priority:** P2 unless noted

**Rule:** do not start these until the integration foundation is proven by MCP
and the Obsidian pilot

## Evaluation score

Score each proposal before implementation:

| Factor | Weight | Question |
|---|---:|---|
| Daily value | 30% | Does this improve capture, retrieval, or task completion every week? |
| Reuse | 20% | Does it use the integration gateway without new privilege shortcuts? |
| Data safety | 20% | Can it avoid silent overwrite, deletion, or lock-in? |
| Maintenance | 15% | Is the external protocol stable and testable? |
| Privacy | 15% | Can the user understand and limit what leaves bkemo? |

## Candidate A — CLI and TypeScript SDK

Provide `bkemo` commands and a typed client generated from the curated
integration contract:

```text
bkemo notes search "..."
bkemo notes create --content "..."
bkemo tasks today
bkemo changes watch
```

This becomes the reference adapter and smoke-test tool for MCP and Obsidian.
Use scoped tokens, JSON output, idempotency keys, and portable IDs. Avoid
wrapping every internal tRPC route.

**Gate:** integration gateway and OpenAPI contract tests are stable.

## Candidate B — outbound webhooks and event subscriptions

Allow users to subscribe to durable integration events:

- note created/updated/archived/trashed;
- task completed or due soon;
- attachment added;
- tag assigned.

Deliver signed, redacted payloads with event IDs, retry limits, exponential
backoff, dead-letter visibility, and replay. Never include full note content
unless the subscription explicitly requests and is authorized for it.

**Gate:** stable portable change events and secret encryption.

## Candidate C — calendar and task interoperability

Start read-only:

- per-account ICS subscription for due tasks;
- stable event UID from note `portableId`;
- timezone-correct due dates;
- links back to canonical bkemo routes.

Consider CalDAV writes only after conditional updates and conflict behavior are
proven. Calendar deletion must not hard-delete a memo; at most it removes a due
date or moves the task to a review queue.

**Gate:** task revision contract and timezone tests.

## Candidate D — automation rules

Build user-visible trigger/action rules on the same change journal:

```text
when tag becomes #waiting
and due date is empty
then set due date to +7 days
```

Start with a fixed catalogue of local actions. Add external HTTP/MCP actions
only after allowlists, confirmation policy, limits, audit, and secret storage
are available.

Automations must record causation IDs so their own writes do not loop.

**Gate:** idempotency, audit events, and loop detection.

## Candidate E — browser capture and reading inbox

Add a small browser extension or share target for:

- selected text + source URL;
- page title and canonical URL;
- screenshot or image attachment with explicit consent;
- default tag/folder/routing rule.

Prefer a scoped `notes:write` credential with no read permission. Run URL
metadata retrieval through the existing safe outbound URL checks.

**Gate:** capture-only token profile and attachment limits.

## Candidate F — local/private semantic index

Offer a local embedding/index adapter for users who do not want note text sent
to a hosted embedding provider:

- desktop-local index for Tauri;
- explicit per-note exclusion;
- encrypted or rebuildable index;
- clear model provenance and storage size;
- identical query interface to the server RAG path.

Do not promise cross-device parity until index synchronization and model
compatibility are designed.

**Gate:** privacy model and measured desktop performance.

## Candidate G — integration health center

Create one Settings surface for:

- credentials and scopes;
- connector health and last successful cursor;
- queued/retried/conflicted work;
- per-connector data-access summary;
- revoke/disable controls;
- redacted downloadable diagnostics.

Use the bkemo native settings patterns from `docs/agents/UI.md`. Avoid exposing
raw environment JSON or secret-bearing headers after initial entry.

**Gate:** two installed connectors provide real shared behavior.

## Recommended order after the pilots

1. CLI/SDK, because it improves testing and operator workflows.
2. Integration health center, because users need visibility before automation.
3. Read-only calendar feed and signed webhooks.
4. Browser capture.
5. Fixed local automation rules.
6. External MCP/HTTP actions and CalDAV writes.
7. Local semantic index after performance and privacy validation.

## Explicit deferrals

- General third-party plugin marketplace.
- Arbitrary user scripts on the server.
- Unsandboxed stdio MCP packages in production.
- Bidirectional sync without revisions and conflict copies.
- Silent external actions triggered by model output.
- A second canonical note format besides Markdown.
