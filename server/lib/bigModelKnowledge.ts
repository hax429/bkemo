const BIGMODEL_API_BASE = "https://open.bigmodel.cn/api";

type FetchLike = typeof fetch;

export type BigModelDocumentStatus = {
  documentId: string;
  name?: string;
  embeddingStat?: number;
  wordCount?: number;
  failure?: { code?: number; message?: string } | null;
};

export type BigModelUploadResult = {
  documentId: string;
  filename: string;
};

class BigModelRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "BigModelRequestError";
  }
}

function safeMessage(payload: any, fallback: string): string {
  const message =
    typeof payload?.message === "string" ? payload.message.trim() : "";
  return (message || fallback).slice(0, 500);
}

async function parseResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new BigModelRequestError(
      `BigModel returned an invalid response with status ${response.status}`,
      response.status >= 500,
    );
  }
}

async function requestWithRetry(
  url: string,
  apiKey: string,
  init: RequestInit,
  fetchImpl: FetchLike = fetch,
  attempts = 3,
): Promise<any> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30_000),
      });
      const payload = await parseResponse(response);
      if (
        !response.ok ||
        (typeof payload?.code === "number" && payload.code !== 200)
      ) {
        const retryable = response.status === 429 || response.status >= 500;
        throw new BigModelRequestError(
          safeMessage(
            payload,
            `BigModel request failed with status ${response.status}`,
          ),
          retryable,
        );
      }
      return payload;
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof BigModelRequestError ? error.retryable : true;
      if (!retryable || attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 400));
    }
  }
  const message =
    lastError instanceof Error ? lastError.message : "BigModel request failed";
  throw new Error(message.slice(0, 500));
}

export async function testBigModelKnowledgeConnection(
  apiKey: string,
  knowledgeBaseId: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: true; documentCount: number }> {
  const query = new URLSearchParams({
    knowledge_id: knowledgeBaseId,
    page: "1",
    size: "1",
  });
  const payload = await requestWithRetry(
    `${BIGMODEL_API_BASE}/llm-application/open/document?${query}`,
    apiKey,
    { method: "GET" },
    fetchImpl,
    1,
  );
  return { ok: true, documentCount: Number(payload?.data?.total ?? 0) };
}

export async function uploadBigModelKnowledgeDocument(
  apiKey: string,
  knowledgeBaseId: string,
  filename: string,
  markdown: string,
  requestId: string,
  fetchImpl: FetchLike = fetch,
): Promise<BigModelUploadResult> {
  const form = new FormData();
  form.append(
    "files",
    new Blob([markdown], { type: "text/markdown; charset=utf-8" }),
    filename,
  );
  form.append("knowledge_type", "1");
  form.append("parse_image", "false");
  form.append("req_id", requestId);
  const payload = await requestWithRetry(
    `${BIGMODEL_API_BASE}/llm-application/open/document/upload_document/${encodeURIComponent(knowledgeBaseId)}`,
    apiKey,
    { method: "POST", body: form },
    fetchImpl,
  );
  const failed = payload?.data?.failedInfos?.[0];
  if (failed)
    throw new Error(
      String(
        failed.failReason || `BigModel rejected ${failed.fileName || filename}`,
      ).slice(0, 500),
    );
  const uploaded = payload?.data?.successInfos?.[0];
  if (!uploaded?.documentId)
    throw new Error(
      "BigModel accepted the request without returning a document ID",
    );
  return {
    documentId: String(uploaded.documentId),
    filename: String(uploaded.fileName || filename),
  };
}

export async function getBigModelKnowledgeDocumentStatus(
  apiKey: string,
  documentId: string,
  fetchImpl: FetchLike = fetch,
): Promise<BigModelDocumentStatus> {
  const payload = await requestWithRetry(
    `${BIGMODEL_API_BASE}/llm-application/open/document/${encodeURIComponent(documentId)}`,
    apiKey,
    { method: "GET" },
    fetchImpl,
    1,
  );
  const data = payload?.data ?? {};
  return {
    documentId: String(data.id || documentId),
    name: typeof data.name === "string" ? data.name : undefined,
    embeddingStat:
      typeof data.embedding_stat === "number" ? data.embedding_stat : undefined,
    wordCount: typeof data.word_num === "number" ? data.word_num : undefined,
    failure: data.failInfo
      ? {
          code: Number(data.failInfo.embedding_code),
          message: String(data.failInfo.embedding_msg || "").slice(0, 500),
        }
      : null,
  };
}

export async function deleteBigModelKnowledgeDocument(
  apiKey: string,
  documentId: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await requestWithRetry(
    `${BIGMODEL_API_BASE}/llm-application/open/document/${encodeURIComponent(documentId)}`,
    apiKey,
    { method: "DELETE" },
    fetchImpl,
    1,
  );
}
