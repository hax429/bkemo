import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { expandScopes, type AccessScope } from '../../shared/lib/accessTokenScopes';
import { NoteType } from '../../shared/lib/types';
import { prisma } from '../prisma';
import { userCaller } from '../routerTrpc/_app';
import { FileService } from './files';
import { stableAttachmentPath } from './attachmentPaths';
import { publishNoteDirty, readNoteChanges } from './noteSync';
import type { IntegrationActor } from './mcpOAuth';
import {
  encodeObsidianSearchCursor,
  noteSourceUrl,
  normalizeObsidianSearch,
  redactIntegrationError,
  sanitizeAttachmentDisplayName,
  taskFilterClause,
  validateAudioUpload,
  type ObsidianSearchFilter,
} from './obsidianContracts';

export class IntegrationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }

  toRedacted() {
    return redactIntegrationError(this.code, this.message);
  }
}

const READ_LIMIT = 100;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

function requireScope(actor: IntegrationActor, scope: AccessScope) {
  if (!actor.scopes.includes(scope)) throw new IntegrationError('forbidden', 'Missing permission for this operation');
}

function actorContext(actor: IntegrationActor) {
  return {
    id: String(actor.accountId),
    sub: String(actor.accountId),
    name: actor.accountName,
    role: actor.role,
    permissions: expandScopes(actor.scopes),
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  } as any;
}

function safeAttachment(attachment: any) {
  return {
    portableId: attachment.portableId,
    name: attachment.name,
    size: Number(attachment.size),
    type: attachment.type,
    path: attachment.portableId ? stableAttachmentPath(attachment.portableId) : undefined,
    createdAt: attachment.createdAt,
  };
}

function safeComment(comment: any) {
  return {
    portableId: comment.portableId,
    content: comment.content,
    author: comment.account?.nickname || comment.account?.name || comment.guestName || 'Guest',
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}

export function safeNote(note: any, scopes: AccessScope[] = []) {
  return {
    portableId: note.portableId,
    revision: note.revision,
    type: note.type,
    content: note.content,
    isArchived: note.isArchived,
    isRecycle: note.isRecycle,
    dueDate: note.dueDate,
    isImportant: note.isImportant,
    isUrgent: note.isUrgent,
    completedAt: note.completedAt,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    source: note.portableId ? noteSourceUrl(note.portableId) : undefined,
    tags: scopes.includes('tags:read') ? (note.tags || []).map((item: any) => ({
      portableId: item.tag?.portableId,
      name: item.tag?.name,
    })).filter((item: any) => item.portableId) : undefined,
    attachments: scopes.includes('attachments:read') ? (note.attachments || []).map(safeAttachment) : undefined,
    comments: scopes.includes('comments:read') ? (note.comments || []).map(safeComment) : undefined,
  };
}

const noteInclude = {
  tags: { include: { tag: true } },
  attachments: { orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }] },
  comments: {
    include: { account: { select: { name: true, nickname: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
};

async function loadOwnedNote(actor: IntegrationActor, portableId: string) {
  const note = await prisma.notes.findFirst({
    where: { portableId, accountId: actor.accountId },
    include: noteInclude,
  });
  if (!note) throw new IntegrationError('not_found', 'Note not found');
  return note;
}

async function audit(actor: IntegrationActor, operation: string, started: number, outcome: string, targetId?: string, errorCode?: string) {
  await prisma.integrationAudit.create({
    data: {
      id: randomUUID(),
      accountId: actor.accountId,
      credentialId: actor.credentialId,
      source: actor.source,
      operation,
      outcome,
      targetId,
      durationMs: Math.max(0, Date.now() - started),
      errorCode,
    },
  }).catch(() => undefined);
}

async function observed<T>(actor: IntegrationActor, operation: string, fn: () => Promise<T>, targetId?: string): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    void audit(actor, operation, started, 'success', targetId);
    return result;
  } catch (error) {
    void audit(actor, operation, started, 'error', targetId, error instanceof IntegrationError ? error.code : 'internal');
    throw error;
  }
}

async function idempotent<T>(actor: IntegrationActor, operation: string, key: string, fn: () => Promise<T>): Promise<T> {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new IntegrationError('invalid_idempotency_key', 'Idempotency key must be 8-128 safe characters');
  }
  const unique = { credentialId_operation_key: { credentialId: actor.credentialId, operation, key } };
  const lockKey = `${actor.credentialId}:${operation}:${key}`;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const existing = await tx.integrationIdempotency.findUnique({ where: unique });
    if (existing?.expiresAt && existing.expiresAt > new Date()) return existing.result as T;
    if (existing) await tx.integrationIdempotency.delete({ where: { id: existing.id } });

    const result = await fn();
    await tx.integrationIdempotency.create({
      data: {
        id: randomUUID(),
        accountId: actor.accountId,
        credentialId: actor.credentialId,
        operation,
        key,
        result: result as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
    });
    return result;
  }, { maxWait: 5_000, timeout: 30_000 });
}

export class IntegrationGateway {
  async searchNotes(actor: IntegrationActor, input: {
    query?: string;
    limit?: number;
    includeArchived?: boolean;
    tag?: string;
    tasksOnly?: boolean;
    archived?: 'exclude' | 'only' | 'include';
    cursor?: string | null;
  }) {
    requireScope(actor, 'notes:read');
    return observed(actor, 'search_notes', async () => {
      const filter = normalizeObsidianSearch({
        query: input.query,
        limit: input.limit,
        tag: input.tag,
        tasksOnly: input.tasksOnly,
        archived: input.archived ?? (input.includeArchived ? 'include' : 'exclude'),
        cursor: input.cursor,
      } satisfies ObsidianSearchFilter);

      const cursorClause = filter.cursorUpdatedAt && filter.cursorPortableId
        ? {
          OR: [
            { updatedAt: { lt: filter.cursorUpdatedAt } },
            { updatedAt: filter.cursorUpdatedAt, portableId: { lt: filter.cursorPortableId } },
          ],
        }
        : {};

      const rows = await prisma.notes.findMany({
        where: {
          accountId: actor.accountId,
          isRecycle: false,
          ...(filter.archived === 'exclude' && { isArchived: false }),
          ...(filter.archived === 'only' && { isArchived: true }),
          ...(filter.query && { content: { contains: filter.query, mode: 'insensitive' } }),
          ...(filter.tag && {
            tags: { some: { tag: { name: { equals: filter.tag, mode: 'insensitive' }, accountId: actor.accountId } } },
          }),
          ...taskFilterClause(filter.tasksOnly),
          ...cursorClause,
        },
        include: noteInclude,
        orderBy: [{ updatedAt: 'desc' }, { portableId: 'desc' }],
        take: filter.limit + 1,
      });
      const page = rows.slice(0, filter.limit);
      const last = page[page.length - 1];
      return {
        notes: page.map((note) => safeNote(note, actor.scopes)),
        nextCursor: rows.length > filter.limit && last
          ? encodeObsidianSearchCursor(last.updatedAt, last.portableId)
          : null,
      };
    });
  }

  async getNote(actor: IntegrationActor, portableId: string) {
    requireScope(actor, 'notes:read');
    return observed(actor, 'get_note', async () => safeNote(await loadOwnedNote(actor, portableId), actor.scopes), portableId);
  }

  async listTasks(actor: IntegrationActor, input: { completed?: boolean; dueBefore?: string; limit?: number }) {
    requireScope(actor, 'notes:read');
    return observed(actor, 'list_tasks', async () => {
      const rows = await prisma.notes.findMany({
        where: {
          accountId: actor.accountId,
          isRecycle: false,
          isArchived: false,
          OR: [{ type: NoteType.TODO }, { dueDate: { not: null } }],
          ...(input.completed !== undefined && { completedAt: input.completed ? { not: null } : null }),
          ...(input.dueBefore && { dueDate: { lte: new Date(input.dueBefore) } }),
        },
        include: noteInclude,
        orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
        take: Math.min(READ_LIMIT, Math.max(1, input.limit || 50)),
      });
      return rows.map((note) => safeNote(note, actor.scopes));
    });
  }

  async listTags(actor: IntegrationActor) {
    requireScope(actor, 'tags:read');
    return observed(actor, 'list_tags', () => prisma.tag.findMany({
      where: { accountId: actor.accountId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { portableId: true, name: true, icon: true, parent: true },
    }));
  }

  async listFiles(actor: IntegrationActor, limit = 50) {
    requireScope(actor, 'attachments:read');
    return observed(actor, 'list_files', async () => {
      const rows = await prisma.attachments.findMany({
        where: { accountId: actor.accountId },
        orderBy: { createdAt: 'desc' },
        take: Math.min(READ_LIMIT, Math.max(1, limit)),
      });
      return rows.map(safeAttachment);
    });
  }

  async listRecentChanges(actor: IntegrationActor, cursor = 0, limit = 100) {
    requireScope(actor, 'notes:read');
    return observed(actor, 'list_recent_changes', async () => {
      const page = await readNoteChanges(prisma, actor.accountId, cursor, Math.min(READ_LIMIT, Math.max(1, limit)));
      const removed = page.removedIds.length
        ? await prisma.notes.findMany({ where: { id: { in: page.removedIds }, accountId: actor.accountId }, select: { portableId: true } })
        : [];
      return {
        cursor: page.cursor,
        hasMore: page.hasMore,
        changed: page.snapshots.map((note) => safeNote(note, actor.scopes)),
        removedPortableIds: removed.map((note) => note.portableId),
      };
    });
  }

  async createNote(actor: IntegrationActor, input: {
    content: string;
    task?: boolean;
    dueDate?: string | null;
    important?: boolean;
    urgent?: boolean;
    attachmentPortableIds?: string[];
    idempotencyKey: string;
  }) {
    requireScope(actor, 'notes:write');
    return observed(actor, input.task ? 'create_task' : 'create_note', () => idempotent(actor, input.task ? 'create_task' : 'create_note', input.idempotencyKey, async () => {
      const attachmentIds = [...new Set(input.attachmentPortableIds || [])];
      let attachments: Array<{ name: string; path: string; size: number; type: string }> = [];
      if (attachmentIds.length) {
        requireScope(actor, 'attachments:write');
        const owned = await prisma.attachments.findMany({
          where: {
            portableId: { in: attachmentIds },
            accountId: actor.accountId,
            OR: [{ noteId: null }, { note: { accountId: actor.accountId } }],
          },
        });
        if (owned.length !== attachmentIds.length) {
          throw new IntegrationError('not_found', 'Attachment not found');
        }
        attachments = owned.map((item) => ({
          name: item.name,
          path: item.path,
          size: Number(item.size),
          type: item.type,
        }));
      }

      const result = await userCaller(actorContext(actor)).notes.upsert({
        content: input.content,
        type: input.task ? NoteType.TODO : NoteType.BLINKO,
        dueDate: input.dueDate,
        isImportant: input.important ?? false,
        isUrgent: input.urgent ?? false,
        attachments,
      });
      return safeNote(await loadOwnedNote(actor, result.portableId), actor.scopes);
    }));
  }

  async getAttachment(actor: IntegrationActor, portableId: string) {
    requireScope(actor, 'attachments:read');
    return observed(actor, 'get_attachment', async () => {
      const attachment = await prisma.attachments.findFirst({
        where: {
          portableId,
          accountId: actor.accountId,
        },
      });
      if (!attachment) throw new IntegrationError('not_found', 'Attachment not found');
      return safeAttachment(attachment);
    }, portableId);
  }

  async uploadAudio(actor: IntegrationActor, input: {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
    durationSeconds?: number | null;
    idempotencyKey: string;
  }) {
    requireScope(actor, 'attachments:write');
    return observed(actor, 'upload_audio', () => idempotent(actor, 'upload_audio', input.idempotencyKey, async () => {
      const mediaError = validateAudioUpload({
        mimeType: input.mimeType,
        sizeBytes: input.buffer.length,
        durationSeconds: input.durationSeconds,
      });
      if (mediaError) throw new IntegrationError(mediaError, mediaError);

      const fileName = sanitizeAttachmentDisplayName(input.fileName);
      const uploaded = await FileService.uploadFile({
        buffer: input.buffer,
        originalName: fileName,
        type: input.mimeType.split(';')[0]?.trim().toLowerCase() || 'audio/webm',
        accountId: actor.accountId,
        metadata: {
          isUserVoiceRecording: true,
          ...(input.durationSeconds != null && {
            audioDurationSeconds: input.durationSeconds,
            audioDuration: String(input.durationSeconds),
          }),
          source: 'obsidian',
        },
      });

      const portableId = uploaded.filePath.match(/\/api\/attachment\/([0-9a-f-]{36})\/file/i)?.[1];
      if (!portableId) throw new IntegrationError('internal', 'Unexpected server error');
      const attachment = await prisma.attachments.findFirst({
        where: { portableId, accountId: actor.accountId },
      });
      if (!attachment) throw new IntegrationError('internal', 'Unexpected server error');
      return safeAttachment(attachment);
    }));
  }

  async updateNote(actor: IntegrationActor, input: {
    portableId: string;
    expectedRevision: number;
    content?: string;
    dueDate?: string | null;
    important?: boolean;
    urgent?: boolean;
    idempotencyKey: string;
  }) {
    requireScope(actor, 'notes:write');
    return observed(actor, 'update_note', () => idempotent(actor, 'update_note', input.idempotencyKey, async () => {
      const existing = await loadOwnedNote(actor, input.portableId);
      try {
        await userCaller(actorContext(actor)).notes.upsert({
          id: existing.id,
          expectedRevision: input.expectedRevision,
          content: input.content ?? null,
          dueDate: input.dueDate,
          isImportant: input.important ?? null,
          isUrgent: input.urgent ?? null,
          attachments: [],
        });
      } catch (error: any) {
        if (error?.code === 'P2025' || String(error?.message).includes('No record was found')) {
          throw new IntegrationError('revision_conflict', 'The note changed after it was read');
        }
        throw error;
      }
      return safeNote(await loadOwnedNote(actor, input.portableId), actor.scopes);
    }), input.portableId);
  }

  private async stateWrite(actor: IntegrationActor, operation: string, input: {
    portableId: string;
    expectedRevision: number;
    idempotencyKey: string;
  }, data: Prisma.notesUpdateManyMutationInput) {
    requireScope(actor, 'notes:write');
    return observed(actor, operation, () => idempotent(actor, operation, input.idempotencyKey, async () => {
      const updated = await prisma.notes.updateMany({
        where: { portableId: input.portableId, accountId: actor.accountId, revision: input.expectedRevision },
        data,
      });
      if (updated.count !== 1) throw new IntegrationError('revision_conflict', 'The note changed after it was read');
      publishNoteDirty(actor.accountId);
      return safeNote(await loadOwnedNote(actor, input.portableId), actor.scopes);
    }), input.portableId);
  }

  completeTask(actor: IntegrationActor, input: { portableId: string; expectedRevision: number; done: boolean; idempotencyKey: string }) {
    return this.stateWrite(actor, 'complete_task', input, { completedAt: input.done ? new Date() : null });
  }

  archiveNote(actor: IntegrationActor, input: { portableId: string; expectedRevision: number; archived: boolean; idempotencyKey: string }) {
    return this.stateWrite(actor, 'archive_note', input, { isArchived: input.archived });
  }

  trashNote(actor: IntegrationActor, input: { portableId: string; expectedRevision: number; idempotencyKey: string }) {
    return this.stateWrite(actor, 'trash_note', input, { isRecycle: true });
  }

  async addComment(actor: IntegrationActor, input: { portableId: string; text: string; idempotencyKey: string }) {
    requireScope(actor, 'comments:write');
    return observed(actor, 'add_comment', () => idempotent(actor, 'add_comment', input.idempotencyKey, async () => {
      const note = await loadOwnedNote(actor, input.portableId);
      await userCaller(actorContext(actor)).comments.create({ noteId: note.id, content: input.text });
      const updated = await loadOwnedNote(actor, input.portableId);
      return safeNote(updated, actor.scopes);
    }), input.portableId);
  }
}

export const integrationGateway = new IntegrationGateway();
