import path from "path";
import { mkdir, readdir, unlink, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { WEEKLY_KNOWLEDGE_TASK_NAME } from "@shared/lib/sharedConstant";
import { UPLOAD_FILE_PATH } from "@shared/lib/pathConstant";
import { prisma } from "../prisma";
import { BaseScheduleJob } from "./baseScheduleJob";
import {
  decryptStorageCredential,
  encryptStorageCredential,
} from "../lib/storageCredentialEncryption";
import {
  deleteBigModelKnowledgeDocument,
  getBigModelKnowledgeDocumentStatus,
  testBigModelKnowledgeConnection,
  uploadBigModelKnowledgeDocument,
} from "../lib/bigModelKnowledge";
import {
  buildWeeklyKnowledgeMarkdown,
  previousCompletedWeek,
  WEEKLY_KNOWLEDGE_EXCLUDE_TAG,
  WEEKLY_KNOWLEDGE_TIMEZONE,
  weeklyKnowledgeFilename,
  type WeeklyKnowledgeNote,
} from "../lib/weeklyKnowledgeMarkdown";

export const WEEKLY_KNOWLEDGE_STATUS_CACHE_KEY = "weekly-knowledge-export";
export const WEEKLY_KNOWLEDGE_API_KEY_CONFIG = "weeklyKnowledgeApiKey";
export const WEEKLY_KNOWLEDGE_BASE_ID_CONFIG = "weeklyKnowledgeBaseId";
export const WEEKLY_KNOWLEDGE_DEFAULT_CRON = "0 3 * * 1";

const EXPORT_DIRECTORY_NAME = "WEEKLY_KNOWLEDGE";

export type WeeklyKnowledgeStatus = {
  periodKey: string;
  rangeStart: string;
  rangeEnd: string;
  timezone: string;
  noteCount: number;
  filename?: string;
  filePath?: string;
  bytes?: number;
  documentId?: string;
  embeddingStat?: number;
  wordCount?: number;
  embeddingFailure?: { code?: number; message?: string } | null;
  uploadedAt?: string;
  checkedAt?: string;
  completedAt: string;
  error?: string;
  warning?: string;
};

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function latestConfigValue(key: string): Promise<string> {
  const row = await prisma.config.findFirst({
    where: { key, userId: null },
    orderBy: { id: "desc" },
  });
  const wrapped = row?.config as { value?: unknown } | string | null;
  return typeof wrapped === "string" ? wrapped : String(wrapped?.value ?? "");
}

export async function getWeeklyKnowledgeSettings(): Promise<{
  apiKey: string;
  knowledgeBaseId: string;
  apiKeyConfigured: boolean;
}> {
  const [encryptedKey, knowledgeBaseId] = await Promise.all([
    latestConfigValue(WEEKLY_KNOWLEDGE_API_KEY_CONFIG),
    latestConfigValue(WEEKLY_KNOWLEDGE_BASE_ID_CONFIG),
  ]);
  const apiKey = encryptedKey ? decryptStorageCredential(encryptedKey) : "";
  return { apiKey, knowledgeBaseId, apiKeyConfigured: Boolean(apiKey) };
}

export async function saveWeeklyKnowledgeSettings(input: {
  apiKey?: string;
  knowledgeBaseId: string;
}): Promise<void> {
  const current = await getWeeklyKnowledgeSettings();
  const apiKey = input.apiKey?.trim() || current.apiKey;
  const knowledgeBaseId = input.knowledgeBaseId.trim();
  if (!apiKey) throw new Error("Enter a BigModel API key");
  if (!/^\d{6,30}$/.test(knowledgeBaseId))
    throw new Error("Enter a valid BigModel knowledge base ID");
  const entries: Array<[string, string]> = [
    [WEEKLY_KNOWLEDGE_API_KEY_CONFIG, encryptStorageCredential(apiKey)],
    [WEEKLY_KNOWLEDGE_BASE_ID_CONFIG, knowledgeBaseId],
  ];
  await prisma.$transaction(async (tx) => {
    for (const [key, value] of entries) {
      await tx.config.deleteMany({ where: { key, userId: null } });
      await tx.config.create({
        data: { key, config: { type: "string", value } },
      });
    }
  });
}

export async function testSavedWeeklyKnowledgeConnection() {
  const settings = await requireSettings();
  return testBigModelKnowledgeConnection(
    settings.apiKey,
    settings.knowledgeBaseId,
  );
}

export async function getWeeklyKnowledgeStatus(): Promise<WeeklyKnowledgeStatus | null> {
  const row = await prisma.cache.findUnique({
    where: { key: WEEKLY_KNOWLEDGE_STATUS_CACHE_KEY },
  });
  return (row?.value as WeeklyKnowledgeStatus | null) ?? null;
}

async function saveStatus(status: WeeklyKnowledgeStatus): Promise<void> {
  await prisma.cache.upsert({
    where: { key: WEEKLY_KNOWLEDGE_STATUS_CACHE_KEY },
    update: { value: jsonValue(status) },
    create: {
      key: WEEKLY_KNOWLEDGE_STATUS_CACHE_KEY,
      value: jsonValue(status),
    },
  });
}

async function requireSettings() {
  const settings = await getWeeklyKnowledgeSettings();
  if (!settings.apiKey)
    throw new Error(
      "Configure a BigModel API key before running the weekly export",
    );
  if (!settings.knowledgeBaseId)
    throw new Error(
      "Configure a BigModel knowledge base ID before running the weekly export",
    );
  return settings;
}

async function firstSuperadminId(): Promise<number> {
  const account = await prisma.accounts.findFirst({
    where: { role: "superadmin" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (!account) throw new Error("No configured superadmin account was found");
  return account.id;
}

async function collectNotes(
  accountId: number,
  start: Date,
  end: Date,
): Promise<WeeklyKnowledgeNote[]> {
  const notes = await prisma.notes.findMany({
    where: { accountId, isRecycle: false, createdAt: { gte: start, lt: end } },
    select: {
      portableId: true,
      type: true,
      content: true,
      isArchived: true,
      isTop: true,
      isImportant: true,
      isUrgent: true,
      createdAt: true,
      updatedAt: true,
      dueDate: true,
      completedAt: true,
      tags: { select: { tag: { select: { name: true } } } },
      attachments: { select: { name: true, type: true, size: true } },
    },
    orderBy: [{ createdAt: "asc" }, { portableId: "asc" }],
  });
  return notes
    .filter(
      (note) =>
        !note.tags.some(
          ({ tag }) =>
            tag.name.trim().toLowerCase() === WEEKLY_KNOWLEDGE_EXCLUDE_TAG,
        ),
    )
    .map((note) => ({
      ...note,
      tags: note.tags.map(({ tag }) => tag.name),
      attachments: note.attachments.map((attachment) => ({
        name: attachment.name,
        type: attachment.type,
        size: attachment.size.toString(),
      })),
    }));
}

async function clearLatestExportDirectory(): Promise<string> {
  const directory = path.join(UPLOAD_FILE_PATH, "temp", EXPORT_DIRECTORY_NAME);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => unlink(path.join(directory, entry.name))),
  );
  return directory;
}

export async function refreshWeeklyKnowledgeDocumentStatus(): Promise<WeeklyKnowledgeStatus> {
  const [settings, current] = await Promise.all([
    requireSettings(),
    getWeeklyKnowledgeStatus(),
  ]);
  if (!current?.documentId)
    throw new Error("No uploaded weekly document is available to check");
  const remote = await getBigModelKnowledgeDocumentStatus(
    settings.apiKey,
    current.documentId,
  );
  const updated: WeeklyKnowledgeStatus = {
    ...current,
    embeddingStat: remote.embeddingStat,
    wordCount: remote.wordCount,
    embeddingFailure: remote.failure,
    checkedAt: new Date().toISOString(),
  };
  await saveStatus(updated);
  return updated;
}

export class WeeklyKnowledgeJob extends BaseScheduleJob {
  protected static taskName = WEEKLY_KNOWLEDGE_TASK_NAME;
  protected static cronSchedule = WEEKLY_KNOWLEDGE_DEFAULT_CRON;
  protected static defaultTimezone = WEEKLY_KNOWLEDGE_TIMEZONE;

  protected static async RunTask() {
    const range = previousCompletedWeek(new Date(), WEEKLY_KNOWLEDGE_TIMEZONE);
    const periodKey = `${range.startDate}:${range.endDate}`;
    const base: WeeklyKnowledgeStatus = {
      periodKey,
      rangeStart: range.start.toISOString(),
      rangeEnd: range.end.toISOString(),
      timezone: range.timezone,
      noteCount: 0,
      completedAt: new Date().toISOString(),
    };
    try {
      const [settings, accountId, previous] = await Promise.all([
        requireSettings(),
        firstSuperadminId(),
        getWeeklyKnowledgeStatus(),
      ]);
      const notes = await collectNotes(accountId, range.start, range.end);
      const directory = await clearLatestExportDirectory();
      if (notes.length === 0) {
        const empty = {
          ...base,
          noteCount: 0,
          completedAt: new Date().toISOString(),
        };
        await saveStatus(empty);
        return empty;
      }

      const markdown = buildWeeklyKnowledgeMarkdown(range, notes);
      const filename = weeklyKnowledgeFilename(range);
      const target = path.join(directory, filename);
      await writeFile(target, markdown, { encoding: "utf8", mode: 0o600 });
      const prepared: WeeklyKnowledgeStatus = {
        ...base,
        noteCount: notes.length,
        filename,
        filePath: `/api/file/temp/${EXPORT_DIRECTORY_NAME}/${filename}`,
        bytes: Buffer.byteLength(markdown),
        completedAt: new Date().toISOString(),
      };
      await saveStatus(prepared);

      const uploaded = await uploadBigModelKnowledgeDocument(
        settings.apiKey,
        settings.knowledgeBaseId,
        filename,
        markdown,
        `${periodKey}:${randomUUID()}`,
      );
      let status: WeeklyKnowledgeStatus = {
        ...prepared,
        documentId: uploaded.documentId,
        uploadedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      await saveStatus(status);

      try {
        const remote = await getBigModelKnowledgeDocumentStatus(
          settings.apiKey,
          uploaded.documentId,
        );
        status = {
          ...status,
          embeddingStat: remote.embeddingStat,
          wordCount: remote.wordCount,
          embeddingFailure: remote.failure,
          checkedAt: new Date().toISOString(),
        };
      } catch (error) {
        status.warning =
          error instanceof Error
            ? `Uploaded, but status check failed: ${error.message}`
            : "Uploaded, but status check failed";
      }

      if (
        previous?.periodKey === periodKey &&
        previous.documentId &&
        previous.documentId !== uploaded.documentId
      ) {
        try {
          await deleteBigModelKnowledgeDocument(
            settings.apiKey,
            previous.documentId,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "unknown error";
          status.warning =
            `Replacement uploaded, but the previous document could not be deleted: ${message}`.slice(
              0,
              500,
            );
        }
      }
      await saveStatus(status);
      return status;
    } catch (error) {
      const failed: WeeklyKnowledgeStatus = {
        ...base,
        ...(await getWeeklyKnowledgeStatus().catch(() => null)),
        periodKey,
        rangeStart: range.start.toISOString(),
        rangeEnd: range.end.toISOString(),
        timezone: range.timezone,
        completedAt: new Date().toISOString(),
        error:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "Weekly knowledge export failed",
      };
      await saveStatus(failed).catch(() => undefined);
      throw error;
    }
  }
}
