import { describe, expect, test, vi } from "vitest";
import {
  getBigModelKnowledgeDocumentStatus,
  testBigModelKnowledgeConnection,
  uploadBigModelKnowledgeDocument,
} from "../../../lib/bigModelKnowledge";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("BigModel knowledge API client", () => {
  test("tests access with a bounded document list request", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ code: 200, data: { total: 7, list: [] } }),
    );
    await expect(
      testBigModelKnowledgeConnection(
        "secret",
        "2083396773522612224",
        fetchImpl as typeof fetch,
      ),
    ).resolves.toEqual({ ok: true, documentCount: 7 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("knowledge_id=2083396773522612224");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret",
    );
  });

  test("uploads Markdown with the documented slicing fields", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        code: 200,
        data: {
          successInfos: [{ documentId: "doc-1", fileName: "week.md" }],
          failedInfos: [],
        },
      }),
    );
    await expect(
      uploadBigModelKnowledgeDocument(
        "secret",
        "2083396773522612224",
        "week.md",
        "# Week",
        "request-1",
        fetchImpl as typeof fetch,
      ),
    ).resolves.toEqual({ documentId: "doc-1", filename: "week.md" });
    const form = fetchImpl.mock.calls[0][1]?.body as FormData;
    expect(form.get("knowledge_type")).toBe("1");
    expect(form.get("parse_image")).toBe("false");
    expect(form.get("req_id")).toBe("request-1");
    expect((form.get("files") as File).name).toBe("week.md");
  });

  test("returns vectorization details without inventing status labels", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        code: 200,
        data: {
          id: "doc-1",
          name: "week.md",
          embedding_stat: 2,
          word_num: 123,
          failInfo: { embedding_code: 10002, embedding_msg: "too large" },
        },
      }),
    );
    await expect(
      getBigModelKnowledgeDocumentStatus(
        "secret",
        "doc-1",
        fetchImpl as typeof fetch,
      ),
    ).resolves.toEqual({
      documentId: "doc-1",
      name: "week.md",
      embeddingStat: 2,
      wordCount: 123,
      failure: { code: 10002, message: "too large" },
    });
  });
});
