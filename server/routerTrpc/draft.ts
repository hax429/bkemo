import { Prisma, type PrismaClient } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { NoteType } from '@shared/lib/types';
import { authProcedure, router } from '@server/middleware';
import { prisma } from '@server/prisma';
import { publishDraftDirty, publishNoteDirty } from '@server/lib/noteSync';
import { FileService } from '@server/lib/files';
import { getGlobalConfig } from './config';
import { AiService } from '@server/aiServer';
import { SendWebhook } from '@server/lib/helper';

export const DRAFT_LEASE_MS = 2 * 60 * 1000;

export function draftLeaseExpiry(at: Date): Date {
  return new Date(at.getTime() + DRAFT_LEASE_MS);
}

export function canClaimDraft(
  draft: { writerId: string | null; leaseExpiresAt: Date | null },
  writerId: string,
  at: Date,
): boolean {
  return draft.writerId === writerId || !draft.writerId || !draft.leaseExpiresAt || draft.leaseExpiresAt <= at;
}

const writerIdSchema = z.string().trim().min(1).max(128);
const dueDateSchema = z.union([z.date(), z.string().datetime(), z.null()]);
const draftFieldsSchema = z.object({
  content: z.string(),
  type: z.nativeEnum(NoteType),
  isImportant: z.boolean(),
  isUrgent: z.boolean(),
  dueDate: dueDateSchema,
});
const draftAttachmentSchema = z.object({
  name: z.string(),
  path: z.string(),
  size: z.union([z.string(), z.number()]),
  type: z.string(),
});
const composeDraftSchema = z.object({
  id: z.number().int(),
  accountId: z.number().int(),
  content: z.string(),
  type: z.number().int(),
  isImportant: z.boolean(),
  isUrgent: z.boolean(),
  dueDate: z.date().nullable(),
  revision: z.number().int(),
  writerId: z.string().nullable(),
  leaseExpiresAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
const draftConflictSchema = z.object({
  ok: z.literal(false),
  conflict: z.object({
    reason: z.enum(['revision', 'writer']),
    current: composeDraftSchema.nullable(),
  }),
});
const draftSuccessSchema = z.object({ ok: z.literal(true), draft: composeDraftSchema });
const draftResultSchema = z.union([draftSuccessSchema, draftConflictSchema]);
const finalizeResultSchema = z.union([
  z.object({ ok: z.literal(true), note: z.any() }),
  draftConflictSchema,
]);

type DraftDb = Pick<PrismaClient, 'composeDraft' | 'notes' | 'noteReference' | 'tag' | 'tagsToNote' | 'attachments' | '$transaction'>;
type DraftEventPublishers = {
  draft: (accountId: number) => void;
  note: (accountId: number) => void;
};

const publishers: DraftEventPublishers = {
  draft: publishDraftDirty,
  note: publishNoteDirty,
};

function asDate(value: Date | string | null): Date | null {
  return typeof value === 'string' ? new Date(value) : value;
}

function conflict(reason: 'revision' | 'writer', current: Awaited<ReturnType<PrismaClient['composeDraft']['findUnique']>>) {
  return { ok: false as const, conflict: { reason, current } };
}

function extractTagPaths(content: string): string[][] {
  const withoutCode = content.replace(/```[\s\S]*?```/g, '');
  const matches = withoutCode.match(/(?<!:\/\/)(?<=\s|^)#[^\s#]+(?=\s|$)/g) ?? [];
  return [...new Set(matches)]
    .map((value) => value.slice(1).split('/').map((part) => part.trim()).filter(Boolean))
    .filter((parts) => parts.length > 0);
}

async function createTagRelations(tx: Prisma.TransactionClient, accountId: number, noteId: number, content: string) {
  const relationIds = new Set<number>();
  for (const path of extractTagPaths(content)) {
    let parent = 0;
    for (const name of path) {
      let tag = await tx.tag.findFirst({ where: { accountId, parent, name } });
      tag ??= await tx.tag.create({ data: { accountId, parent, name } });
      parent = tag.id;
      relationIds.add(tag.id);
    }
  }
  if (relationIds.size > 0) {
    await tx.tagsToNote.createMany({
      data: [...relationIds].map((tagId) => ({ noteId, tagId })),
      skipDuplicates: true,
    });
  }
}

export function createDraftRouter(
  db: DraftDb = prisma,
  events: DraftEventPublishers = publishers,
  now: () => Date = () => new Date(),
) {
  return router({
    get: authProcedure
      .output(composeDraftSchema.nullable())
      .query(async ({ ctx }) => {
        return db.composeDraft.findUnique({ where: { accountId: Number(ctx.id) } });
      }),

    claim: authProcedure
      .input(z.object({ writerId: writerIdSchema, expectedRevision: z.number().int().positive().optional() }))
      .output(draftResultSchema)
      .mutation(async ({ input, ctx }) => {
        const accountId = Number(ctx.id);
        const claimedAt = now();
        const leaseExpiresAt = draftLeaseExpiry(claimedAt);

        let current = await db.composeDraft.findUnique({ where: { accountId } });
        if (!current) {
          try {
            current = await db.composeDraft.create({
              data: { accountId, writerId: input.writerId, leaseExpiresAt },
            });
            events.draft(accountId);
            return { ok: true as const, draft: current };
          } catch (error) {
            if ((error as { code?: string }).code !== 'P2002') throw error;
            current = await db.composeDraft.findUnique({ where: { accountId } });
          }
        }

        if (!current) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Draft claim failed' });
        if (input.expectedRevision != null && current.revision !== input.expectedRevision) {
          return conflict('revision', current);
        }
        if (!canClaimDraft(current, input.writerId, claimedAt)) {
          return conflict('writer', current);
        }

        const result = await db.composeDraft.updateMany({
          where: {
            accountId,
            revision: current.revision,
            OR: [
              { writerId: input.writerId },
              { writerId: null },
              { leaseExpiresAt: null },
              { leaseExpiresAt: { lte: claimedAt } },
            ],
          },
          data: { writerId: input.writerId, leaseExpiresAt },
        });
        const latest = await db.composeDraft.findUnique({ where: { accountId } });
        if (result.count !== 1 || !latest) {
          return conflict(latest?.revision !== current.revision ? 'revision' : 'writer', latest);
        }
        events.draft(accountId);
        return { ok: true as const, draft: latest };
      }),

    save: authProcedure
      .input(draftFieldsSchema.extend({ writerId: writerIdSchema, expectedRevision: z.number().int().positive() }))
      .output(draftResultSchema)
      .mutation(async ({ input, ctx }) => {
        const accountId = Number(ctx.id);
        const savedAt = now();
        const result = await db.composeDraft.updateMany({
          where: {
            accountId,
            revision: input.expectedRevision,
            writerId: input.writerId,
            leaseExpiresAt: { gt: savedAt },
          },
          data: {
            content: input.content,
            type: input.type,
            isImportant: input.isImportant,
            isUrgent: input.isUrgent,
            dueDate: asDate(input.dueDate),
            revision: { increment: 1 },
            leaseExpiresAt: draftLeaseExpiry(savedAt),
          },
        });
        const current = await db.composeDraft.findUnique({ where: { accountId } });
        if (result.count !== 1 || !current) {
          return conflict(current?.revision !== input.expectedRevision ? 'revision' : 'writer', current);
        }
        events.draft(accountId);
        return { ok: true as const, draft: current };
      }),

    takeover: authProcedure
      .input(z.object({ writerId: writerIdSchema, expectedRevision: z.number().int().positive() }))
      .output(draftResultSchema)
      .mutation(async ({ input, ctx }) => {
        const accountId = Number(ctx.id);
        const takeoverAt = now();
        const result = await db.composeDraft.updateMany({
          where: { accountId, revision: input.expectedRevision },
          data: {
            writerId: input.writerId,
            leaseExpiresAt: draftLeaseExpiry(takeoverAt),
            revision: { increment: 1 },
          },
        });
        const current = await db.composeDraft.findUnique({ where: { accountId } });
        if (result.count !== 1 || !current) return conflict('revision', current);
        events.draft(accountId);
        return { ok: true as const, draft: current };
      }),

    finalize: authProcedure
      .input(z.object({
        writerId: writerIdSchema,
        expectedRevision: z.number().int().positive(),
        referenceIds: z.array(z.number().int().positive()).default([]),
        attachments: z.array(draftAttachmentSchema).default([]),
      }))
      .output(finalizeResultSchema)
      .mutation(async ({ input, ctx }) => {
        const accountId = Number(ctx.id);
        const finalizedAt = now();
        const referenceIds = [...new Set(input.referenceIds)];
        const attachmentPaths = [...new Set(await Promise.all(
          input.attachments.map((attachment) => FileService.resolveStoredPath(attachment.path)),
        ))];

        const result = await db.$transaction(async (tx) => {
          const current = await tx.composeDraft.findUnique({ where: { accountId } });
          if (!current || current.revision !== input.expectedRevision) return conflict('revision', current);
          if (current.writerId !== input.writerId || !current.leaseExpiresAt || current.leaseExpiresAt <= finalizedAt) {
            return conflict('writer', current);
          }

          // Reserve this exact revision before creating the note. The update is
          // rolled back with the transaction on any later failure.
          const reserved = await tx.composeDraft.updateMany({
            where: {
              accountId,
              revision: input.expectedRevision,
              writerId: input.writerId,
              leaseExpiresAt: { gt: finalizedAt },
            },
            data: { revision: { increment: 1 } },
          });
          if (reserved.count !== 1) {
            const latest = await tx.composeDraft.findUnique({ where: { accountId } });
            return conflict(latest?.revision !== input.expectedRevision ? 'revision' : 'writer', latest);
          }

          if (referenceIds.length > 0) {
            const ownedReferences = await tx.notes.count({ where: { accountId, id: { in: referenceIds } } });
            if (ownedReferences !== referenceIds.length) {
              throw new TRPCError({ code: 'FORBIDDEN', message: 'Every referenced note must belong to this account' });
            }
          }
          const ownedAttachments = attachmentPaths.length > 0
            ? await tx.attachments.findMany({
              where: { accountId, path: { in: attachmentPaths } },
              select: { id: true, path: true },
            })
            : [];
          if (ownedAttachments.length !== attachmentPaths.length) {
            throw new TRPCError({ code: 'FORBIDDEN', message: 'Every attachment must belong to this account' });
          }

          const note = await tx.notes.create({
            data: {
              accountId,
              content: current.content,
              type: current.type,
              isImportant: current.isImportant,
              isUrgent: current.isUrgent,
              dueDate: current.dueDate,
            },
          });
          if (referenceIds.length > 0) {
            await tx.noteReference.createMany({
              data: referenceIds.map((toNoteId) => ({ fromNoteId: note.id, toNoteId })),
            });
          }
          if (ownedAttachments.length > 0) {
            await tx.attachments.updateMany({
              where: { id: { in: ownedAttachments.map(({ id }) => id) }, accountId },
              data: { noteId: note.id },
            });
          }
          await createTagRelations(tx, accountId, note.id, current.content);
          const deleted = await tx.composeDraft.deleteMany({
            where: {
              accountId,
              revision: input.expectedRevision + 1,
              writerId: input.writerId,
            },
          });
          if (deleted.count !== 1) {
            throw new TRPCError({ code: 'CONFLICT', message: 'Draft changed while it was being finalized' });
          }
          return { ok: true as const, note };
        });

        if (result.ok) {
          events.note(accountId);
          events.draft(accountId);
          const config = await getGlobalConfig({ ctx });
          if (config?.embeddingModelId) {
            void AiService.embeddingUpsert({
              id: result.note.id,
              content: result.note.content,
              type: 'insert',
              createTime: result.note.createdAt,
              updatedAt: result.note.updatedAt,
            });
          }
          if (config?.isUseAiPostProcessing) {
            void AiService.postProcessNote({ noteId: result.note.id, ctx }).catch((error) => {
              console.error('Draft note post-processing failed:', error);
            });
          }
          SendWebhook({ ...result.note, attachments: input.attachments }, 'create', ctx);
        }
        return result;
      }),
  });
}

export const draftRouter = createDraftRouter();
