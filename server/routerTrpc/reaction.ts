import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { prisma } from '../prisma';
import { router, publicProcedure } from '../middleware';

/** Resolve the effective reactor id: logged-in account or anonymous guest id. */
function reactorId(ctxId: string | number | undefined, guestId?: string): string {
  if (ctxId) return `acct:${ctxId}`;
  return guestId && guestId.trim() ? guestId.trim() : '';
}

/** A note is reactable if it's publicly shared, or owned by the caller. */
async function assertReactable(noteId: number, ctxId: string | number | undefined) {
  const note = await prisma.notes.findFirst({ where: { id: noteId }, select: { isShare: true, accountId: true } });
  if (!note) throw new TRPCError({ code: 'NOT_FOUND', message: 'Note not found' });
  const isOwner = ctxId != null && note.accountId === Number(ctxId);
  if (!note.isShare && !isOwner) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Note is not shared' });
  }
}

export const reactionRouter = router({
  list: publicProcedure
    .meta({ openapi: { method: 'POST', path: '/v1/reaction/list', summary: 'List reactions for a note', tags: ['Reaction'] } })
    .input(z.object({ noteId: z.number(), guestId: z.string().optional() }))
    .output(z.array(z.object({ emoji: z.string(), count: z.number(), reactedByMe: z.boolean() })))
    .query(async function ({ input, ctx }) {
      const me = reactorId(ctx.id, input.guestId);
      const rows = await prisma.reaction.findMany({ where: { noteId: input.noteId } });
      const map = new Map<string, { count: number; reactedByMe: boolean }>();
      for (const r of rows) {
        const e = map.get(r.emoji) ?? { count: 0, reactedByMe: false };
        e.count += 1;
        if (me && r.guestId === me) e.reactedByMe = true;
        map.set(r.emoji, e);
      }
      return [...map.entries()].map(([emoji, v]) => ({ emoji, ...v }));
    }),

  toggle: publicProcedure
    .meta({ openapi: { method: 'POST', path: '/v1/reaction/toggle', summary: 'Toggle a reaction', tags: ['Reaction'] } })
    .input(z.object({ noteId: z.number(), emoji: z.string().min(1).max(16), guestId: z.string().optional() }))
    .output(z.object({ added: z.boolean() }))
    .mutation(async function ({ input, ctx }) {
      await assertReactable(input.noteId, ctx.id);
      const me = reactorId(ctx.id, input.guestId);
      if (!me) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Missing reactor id' });
      const existing = await prisma.reaction.findUnique({
        where: { noteId_emoji_guestId: { noteId: input.noteId, emoji: input.emoji, guestId: me } },
      });
      if (existing) {
        await prisma.reaction.delete({ where: { id: existing.id } });
        return { added: false };
      }
      await prisma.reaction.create({ data: { noteId: input.noteId, emoji: input.emoji, guestId: me } });
      return { added: true };
    }),
});
