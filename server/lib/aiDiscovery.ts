import { AiService } from '@server/aiServer';
import { prisma } from '@server/prisma';
import { requireMainChatModel } from '@server/lib/aiConversation';

export type AIDiscoveryKind = 'default' | 'value';
export type AIDiscoveryRange = '3m' | '1y' | 'all';

const VALUE_PROMPT = `You are a thoughtful analytical partner specializing in values clarification. Study the user's notes to uncover values, needs, and tradeoffs beneath choices, emotional reactions, recurring interests, and reflections.

This is not an advice-giving task. Do not tell the user what they should do. Help them recognize what already appears to matter to them.

Internally consider explicit values, implicit values, conflicting values, misaligned values, and one or two core values. Distinguish evidence from interpretation and present inferred values as possibilities, not facts.

Write in English. Address the user as "you." Use a warm, perceptive, gently incisive tone. Do not infer identity, nationality, age, education level, diagnosis, or personal background unless explicitly established. Do not simply summarize the notes.

Structure around: central value pattern; strongest implicit value; main conflict between two important values; possible misalignment between external standards and internal sources of meaning; the core value or combination of values; one or two open questions. Aim to clarify a tension rather than resolve it.`;

const DEFAULT_PROMPT = `You are an insightful analytical partner. Study the user's notes and uncover a deep, counterintuitive, well-supported insight about thinking patterns, motivations, tensions, blind spots, or current direction.

Do not merely summarize. Look beneath fragmentation to identify recurring patterns, hidden connections, productive contradictions, or assumptions the user may not recognize. Treat notes as evidence, not a complete psychological profile. Avoid sensitive inferences, diagnoses, generic encouragement, clichés, and unsupported claims.

Write in English. Open with a question, contrast, or surprising observation. State one primary insight early and clearly, support it with concrete examples from notes, preserve references like BK-123 when useful, explain why the pattern is valuable and how it can become limiting, include one small action the user can take today, recommend one relevant book or resource, provide two useful search keywords, and end with a concise memorable sentence.

After the primary insight, provide two additional insights, each with a compelling hook, core insight, and evidence or reasoning. Keep the response between 700 and 1,200 words.`;

function sinceDate(range: AIDiscoveryRange) {
  const now = new Date();
  if (range === '3m') return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
  if (range === '1y') return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  return undefined;
}

function noteEvidenceBlock(notes: { id: number; content: string; createdAt: Date; updatedAt: Date; attachments: { name: string | null; path: string }[] }[]) {
  return notes.map((note) => {
    const attachments = note.attachments.map((attachment) => attachment.name || attachment.path).filter(Boolean).join(', ');
    return [
      `BK-${note.id}`,
      `Created: ${note.createdAt.toISOString()}`,
      `Updated: ${note.updatedAt.toISOString()}`,
      attachments ? `Attachments: ${attachments}` : '',
      `Content: ${(note.content || '').slice(0, 4500)}`,
    ].filter(Boolean).join('\n');
  }).join('\n\n---\n\n');
}

export async function runAIDiscovery({
  accountId,
  ctx,
  kind,
  range,
  customPrompt,
}: {
  accountId: number;
  ctx: any;
  kind: AIDiscoveryKind;
  range: AIDiscoveryRange;
  customPrompt?: string;
}) {
  await requireMainChatModel();
  const createdAt = sinceDate(range);
  const notes = await prisma.notes.findMany({
    where: {
      accountId,
      isRecycle: false,
      isArchived: false,
      ...(createdAt ? { createdAt: { gte: createdAt } } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: 300,
    select: {
      id: true,
      content: true,
      createdAt: true,
      updatedAt: true,
      attachments: { select: { name: true, path: true }, take: 10 },
    },
  });

  if (notes.length === 0) {
    return {
      content: 'There are no notes in the selected range yet.',
      noteIds: [],
      noteCount: 0,
    };
  }

  const systemPrompt = [
    customPrompt?.trim() || (kind === 'value' ? VALUE_PROMPT : DEFAULT_PROMPT),
    'Use only the supplied notes below. Preserve references like BK-123 when useful. Do not invent missing facts.',
    noteEvidenceBlock(notes),
  ].join('\n\n');

  const { result } = await AiService.completions({
    question: `Run ${kind} discovery for my ${range === '3m' ? 'recent 3 months' : range === '1y' ? 'recent year' : 'full'} bkemo notes.`,
    conversations: [],
    ctx,
    withTools: false,
    withOnline: false,
    withRAG: false,
    systemPrompt,
  });

  let content = '';
  for await (const chunk of result.fullStream) {
    content += chunk?.textDelta ?? chunk?.delta ?? chunk?.text ?? chunk?.content ?? '';
  }

  return {
    content: content.trim(),
    noteIds: notes.map((note) => note.id),
    noteCount: notes.length,
  };
}
