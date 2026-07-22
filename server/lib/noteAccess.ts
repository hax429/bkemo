import { TRPCError } from '@trpc/server';
import { prisma } from '@server/prisma';

export const readableNoteWhere = (accountId: number) => ({
  isRecycle: false,
  OR: [
    { accountId },
    { internalShares: { some: { accountId } } },
  ],
});

export async function requireReadableNote(noteId: number, accountId: number) {
  const note = await prisma.notes.findFirst({
    where: {
      id: noteId,
      ...readableNoteWhere(accountId),
    },
    include: {
      attachments: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      subtasks: {
        where: { isRecycle: false },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      },
      references: {
        select: {
          toNoteId: true,
          toNote: { select: { id: true, content: true, createdAt: true, updatedAt: true } },
        },
      },
      tags: { include: { tag: true } },
    },
  });

  if (!note) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Note not found' });
  }

  return note;
}

export async function requireOwnedConversation(conversationId: number, accountId: number) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, accountId },
  });

  if (!conversation) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found' });
  }

  return conversation;
}

export async function requireOwnedMessage(messageId: number, accountId: number) {
  const message = await prisma.message.findFirst({
    where: {
      id: messageId,
      conversation: { accountId },
    },
    select: {
      id: true,
      conversationId: true,
      createdAt: true,
    },
  });

  if (!message) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Message not found' });
  }

  return message;
}
