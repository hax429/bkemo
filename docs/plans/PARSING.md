# Deterministic document parsing

**Status:** proposal

**Assumption:** parsing means turning an uploaded attachment into useful,
editable Markdown without requiring an AI provider. Confirm the intended input
and user journey before implementation.

## Product outcome

A user selects an existing attachment or uploads a supported document, previews
the extracted content, then creates a new memo or inserts the content into the
current memo. The original attachment remains the source artifact. Parsing must
never silently replace user written content.

The first release should support UTF 8 text, Markdown, CSV, PDF, and DOCX. OCR,
web pages, EPUB, email, and archives should wait until the basic pipeline has
real usage data.

**Related (shipped separately):** URL paste → Notion-like bookmark cards with
server-side Defuddle Markdown and Internet Archive snapshots — see
[`url-bookmark-enrichment.md`](./url-bookmark-enrichment.md). That work is not
part of this attachment parser.

## Current code to reuse or replace

`AiService.loadFileContent` already selects LangChain loaders for PDF, DOCX,
text, and CSV. The behavior is trapped inside the AI module, accepts an
unrestricted filesystem path, loses document structure, and has no focused
tests. Move the deterministic extraction behavior into a parsing module and
make the AI module one caller of it.

The upload system already owns filename sanitation, account scoped attachment
lookup, local and object storage adapters, and content type handling. Parsing
should use those facilities rather than accepting arbitrary client paths or
URLs.

## External seam

Expose one deep module with one operation:

```ts
type ParseDocumentRequest = {
  attachmentId: string;
  accountId: number;
};

type ParsedDocument = {
  title?: string;
  markdown: string;
  sourceType: 'text' | 'markdown' | 'csv' | 'pdf' | 'docx';
  pageCount?: number;
  warnings: string[];
  truncated: boolean;
};

interface DocumentParser {
  parse(request: ParseDocumentRequest): Promise<ParsedDocument>;
}
```

The interface hides storage resolution, content type verification, loader
selection, size limits, normalization, and safe errors. Tests and callers use
the same seam. Format adapters stay internal until at least two implementations
need independent replacement.

## Safety and quality rules

1. Resolve the attachment by both portable ID and account ID.
2. Verify the detected content type instead of trusting only the extension.
3. Reject encrypted files, executable formats, archives, and unsupported types.
4. Bound input bytes, extracted characters, page count, parse duration, and
   concurrent work.
5. Never fetch arbitrary URLs in the first release.
6. Normalize output to Markdown while preserving headings, paragraphs, lists,
   tables, page breaks, and source order where the format allows it.
7. Return stable public errors and keep filenames, note content, paths, and
   credentials out of normal logs.
8. Store the parser version and source attachment revision if parsed output is
   cached, so stale results are never mistaken for current ones.

## Delivery slices

### Slice 1: parser contract

Create `server/lib/documentParser.ts` with text and Markdown adapters. Add byte,
character, and timeout limits. Keep persistence and UI out of this slice.

Acceptance: fixture based unit tests cover valid Unicode, empty input, invalid
encoding, oversized input, truncation, unsupported content, and safe errors.

### Slice 2: structured formats

Move PDF, DOCX, and CSV extraction out of `AiService`. Preserve useful
structure and make `AiService.loadFileContent` delegate to the parser.

Acceptance: each format uses a small checked in fixture and a golden Markdown
result. The same attachment produces deterministic output across repeated runs.

### Slice 3: account scoped endpoint

Add a tRPC query or mutation that accepts only an attachment portable ID. It
resolves the actor account on the server and invokes the parser. Do not expose a
filesystem path or object storage key.

Acceptance: integration tests prove cross account denial, unsupported file
rejection, size limits, timeout mapping, and redacted errors.

### Slice 4: preview UI

Add a Parse action to the attachment viewer. Show idle, parsing, preview,
warning, unsupported, and retry states. Let the user create a new memo or insert
the preview into the editor through an explicit confirmation.

Acceptance: Testing Library covers state transitions and callback payloads.
Rendered browser testing covers keyboard use, focus return, mobile layout, and
large previews.

### Slice 5: background work only if needed

If real documents regularly exceed the request budget, move execution to
pg boss with a durable status record. Do not add a queue preemptively. A job is
justified when synchronous parsing has measured latency or reliability trouble.

## Test matrix

| Layer | Purpose | Required cases |
|---|---|---|
| Pure unit | normalization and limits | Unicode, structure, truncation, malformed input |
| Adapter contract | every format behaves consistently | deterministic output, warnings, safe failure |
| Integration | storage and authorization | local storage, object storage fake, account isolation |
| UI behavior | user visible state | preview, retry, cancel, insert, create memo |
| End to end | critical happy path | upload, parse, preview, create memo |

Avoid snapshots of entire React trees. Golden files are appropriate for parser
output because the output itself is the product contract. Keep fixtures tiny
and generated by known tools so they can be reviewed and redistributed.

## Decisions required before coding

1. Does parsing mean attachments, pasted text, URLs, or all three?
2. Should the result create a new memo, insert into the current memo, or remain
   searchable attachment text?
3. Which formats matter on day one?
4. Is OCR required for scanned PDFs?
5. Should parsed text be cached, and if so, may it sync into exports and native
   offline caches?
