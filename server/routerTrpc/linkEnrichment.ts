import { z } from 'zod';
import { router, authProcedure } from '../middleware';
import { prisma } from '../prisma';
import { TRPCError } from '@trpc/server';
import {
  processLinkEnrichment,
  retryLinkEnrichment,
  updateLinkEnrichmentMarkdown,
} from '../lib/linkEnrichment/service';

const enrichmentOutput = z.object({
  id: z.string(),
  noteId: z.number(),
  url: z.string(),
  status: z.string(),
  title: z.string(),
  description: z.string(),
  favicon: z.string(),
  imageUrl: z.string(),
  imagePath: z.string(),
  markdown: z.string(),
  archiveUrl: z.string(),
  markdownStatus: z.string(),
  archiveStatus: z.string(),
  error: z.string(),
  updatedAt: z.date(),
});

function mapRow(row: any) {
  return {
    id: row.id,
    noteId: row.noteId,
    url: row.url,
    status: row.status,
    title: row.title,
    description: row.description,
    favicon: row.favicon,
    imageUrl: row.imageUrl,
    imagePath: row.imagePath,
    markdown: row.markdown,
    archiveUrl: row.archiveUrl,
    markdownStatus: row.markdownStatus,
    archiveStatus: row.archiveStatus,
    error: row.error,
    updatedAt: row.updatedAt,
  };
}

export const linkEnrichmentRouter = router({
  listForNote: authProcedure
    .input(z.object({ noteId: z.number().int().positive() }))
    .output(z.array(enrichmentOutput))
    .query(async ({ input, ctx }) => {
      const accountId = Number(ctx.id);
      const note = await prisma.notes.findFirst({
        where: { id: input.noteId, accountId },
        select: { id: true },
      });
      if (!note) throw new TRPCError({ code: 'NOT_FOUND', message: 'Note not found' });
      const rows = await prisma.linkEnrichment.findMany({
        where: { noteId: input.noteId, accountId },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(mapRow);
    }),

  getByUrl: authProcedure
    .input(z.object({
      noteId: z.number().int().positive().optional(),
      url: z.string().min(1),
    }))
    .output(enrichmentOutput.nullable())
    .query(async ({ input, ctx }) => {
      const accountId = Number(ctx.id);
      const row = await prisma.linkEnrichment.findFirst({
        where: {
          accountId,
          url: input.url,
          ...(input.noteId ? { noteId: input.noteId } : {}),
        },
        orderBy: { updatedAt: 'desc' },
      });
      return row ? mapRow(row) : null;
    }),

  retry: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .output(enrichmentOutput)
    .mutation(async ({ input, ctx }) => {
      const accountId = Number(ctx.id);
      await retryLinkEnrichment(input.id, accountId);
      const row = await prisma.linkEnrichment.findFirst({ where: { id: input.id, accountId } });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return mapRow(row);
    }),

  saveMarkdown: authProcedure
    .input(z.object({
      id: z.string().uuid(),
      markdown: z.string(),
    }))
    .output(enrichmentOutput)
    .mutation(async ({ input, ctx }) => {
      const accountId = Number(ctx.id);
      await updateLinkEnrichmentMarkdown({
        id: input.id,
        accountId,
        markdown: input.markdown,
      });
      const row = await prisma.linkEnrichment.findFirst({ where: { id: input.id, accountId } });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return mapRow(row);
    }),

  /** Kick a stuck pending row (used by UI polling). */
  process: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const accountId = Number(ctx.id);
      const row = await prisma.linkEnrichment.findFirst({ where: { id: input.id, accountId } });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      void processLinkEnrichment(row.id);
      return { ok: true };
    }),
});
