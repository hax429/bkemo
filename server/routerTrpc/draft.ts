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
import { scheduleLinkEnrichmentForNote } from '@server/lib/linkEnrichment/service';

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

function isBlank(content: string) {
  return !content.trim();
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
) {
  return router({
    get: authProcedure
      .output(composeDraftSchema.nullable())
      .query(async ({ ctx }) => {
        return db.composeDraft.findUnique({ where: { accountId: Number(ctx.id) } });
      }),

    /** Last-write-wins disaster snapshot. Empty content deletes the stored draft. */
    snapshot: authProcedure
      .input(draftFieldsSchema)
      .output(z.object({ ok: z.literal(true), draft: composeDraftSchema.nullable() }))
      .mutation(async ({ input, ctx }) => {
        const accountId = Number(ctx.id);
        if (isBlank(input.content)) {
          await db.composeDraft.deleteMany({ where: { accountId } });
          events.draft(accountId);
          return { ok: true as const, draft: null };
        }

        const data = {
          content: input.content,
          type: input.type,
          isImportant: input.isImportant,
          isUrgent: input.isUrgent,
          dueDate: asDate(input.dueDate),
          writerId: null,
          leaseExpiresAt: null,
        };
        const draft = await db.composeDraft.upsert({
          where: { accountId },
          create: { accountId, ...data },
          update: { ...data, revision: { increment: 1 } },
        });
        events.draft(accountId);
        return { ok: true as const, draft };
      }),

    clear: authProcedure
      .output(z.object({ ok: z.literal(true) }))
      .mutation(async ({ ctx }) => {
        const accountId = Number(ctx.id);
        await db.composeDraft.deleteMany({ where: { accountId } });
        events.draft(accountId);
        return { ok: true as const };
      }),

    finalize: authProcedure
      .input(draftFieldsSchema.extend({
        referenceIds: z.array(z.number().int().positive()).default([]),
        attachments: z.array(draftAttachmentSchema).default([]),
      }))
      .output(z.object({ ok: z.literal(true), note: z.any() }))
      .mutation(async ({ input, ctx }) => {
        const accountId = Number(ctx.id);
        const referenceIds = [...new Set(input.referenceIds)];
        const attachmentPaths = [...new Set(await Promise.all(
          input.attachments.map((attachment) => FileService.resolveStoredPath(attachment.path)),
        ))];

        if (isBlank(input.content) && attachmentPaths.length === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Nothing to save' });
        }

        const note = await db.$transaction(async (tx) => {
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

          const created = await tx.notes.create({
            data: {
              accountId,
              content: input.content,
              type: input.type,
              isImportant: input.isImportant,
              isUrgent: input.isUrgent,
              dueDate: asDate(input.dueDate),
            },
          });
          if (referenceIds.length > 0) {
            await tx.noteReference.createMany({
              data: referenceIds.map((toNoteId) => ({ fromNoteId: created.id, toNoteId })),
            });
          }
          if (ownedAttachments.length > 0) {
            await tx.attachments.updateMany({
              where: { id: { in: ownedAttachments.map(({ id }) => id) }, accountId },
              data: { noteId: created.id },
            });
          }
          await createTagRelations(tx, accountId, created.id, input.content);
          await tx.composeDraft.deleteMany({ where: { accountId } });
          return created;
        });

        events.note(accountId);
        events.draft(accountId);
        const config = await getGlobalConfig({ ctx });
        if (config?.embeddingModelId) {
          void AiService.embeddingUpsert({
            id: note.id,
            content: note.content,
            type: 'insert',
            createTime: note.createdAt,
            updatedAt: note.updatedAt,
          });
        }
        if (config?.isUseAiPostProcessing) {
          void AiService.postProcessNote({ noteId: note.id, ctx }).catch((error) => {
            console.error('Draft note post-processing failed:', error);
          });
        }
        void scheduleLinkEnrichmentForNote({
          noteId: note.id,
          accountId,
          content: note.content,
        }).catch((error) => {
          console.error('Draft link enrichment schedule failed:', error);
        });
        SendWebhook({ ...note, attachments: input.attachments }, 'create', ctx);
        return { ok: true as const, note };
      }),
  });
}

export const draftRouter = createDraftRouter();
