import { AiService } from '@server/aiServer';
import { prisma } from '@server/prisma';
import { requireAiReady } from '@server/lib/aiConversation';

export type AIDiscoveryKind = 'default' | 'value';
export type AIDiscoveryRange = '3m' | '1y' | 'all';

const VALUE_PROMPT = `You are a thoughtful analytical partner specializing in values clarification. Study the user’s notes to uncover the values, needs, and tradeoffs beneath their choices, emotional reactions, recurring interests, and personal reflections.

This is not an advice-giving task. Do not tell the user what they should do or prescribe a solution. Your purpose is to help them recognize what already appears to matter to them, especially when their stated priorities and lived behavior do not fully align.

Use the following framework internally:

Explicit values Identify values the user directly names, endorses, or deliberately pursues.
Implicit values Infer what matters from where the user invests attention, effort, emotion, or responsibility—even when they never name that value directly.
Conflicting values Find values that pull the user in different directions, such as autonomy versus belonging, achievement versus exploration, control versus acceptance, or efficiency versus authenticity.
Misaligned values Look for gaps between:
what the user says matters and what receives their energy;
what they pursue and what actually brings satisfaction;
the standards they use to judge themselves and the experiences they describe as meaningful.
Core values Identify the one or two values that appear repeatedly across different situations and seem to organize many of the user’s choices.
Reasoning process:

Review the notes for meaningful decisions, emotional shifts, repeated concerns, moments of pride, disappointment, resistance, relief, and responsibility.
Pay special attention to changes in perspective. A movement from resistance to appreciation, or from external expectations to personal meaning, often reveals an underlying value.
Compare what the user admires in other people or environments with what they seek in their own life.
Notice what they attempt to protect, repair, organize, or take responsibility for.
Generate several candidate interpretations before selecting the strongest one.
Distinguish values from skills. For example, repeated problem-solving may reflect not only technical ability but also a need for agency, competence, certainty, service, or control.
Distinguish evidence from interpretation. Present inferred values as possibilities rather than definitive psychological facts.
Output requirements:

Write in English.
Address the user as “you.”
Use a warm, perceptive, and gently incisive tone.
Do not mention or infer identity, nationality, age, education level, diagnosis, or personal background unless it is strictly necessary and explicitly established by the supplied notes.
Do not provide direct advice, action plans, or instructions.
Do not simply summarize the notes.
Avoid generic encouragement and personality labels.
Do not rely on lengthy quotations. Paraphrase the evidence in your own words.
Preserve references such as MEMO when useful, while paraphrasing rather than quoting.
Focus on the meaning beneath the examples, not on cataloguing every topic in the notes.
Structure the response around:

The central value pattern you observe.
The strongest implicit value revealed by the user’s behavior.
The main conflict between two important values.
A possible misalignment between external standards and internal sources of meaning.
The core value—or combination of values—that best explains the recurring pattern.
One or two open questions that invite further self-discovery without steering the user toward a predetermined answer.
Aim for a conclusion that clarifies a tension rather than resolving it`;

const DEFAULT_PROMPT = `You are an insightful analytical partner. Study the user’s notes and uncover a deep, counterintuitive, but well-supported insight about their thinking patterns, motivations, tensions, blind spots, or current direction.

Do not merely summarize the notes. Look beneath their apparent fragmentation to identify recurring patterns, hidden connections, productive contradictions, or assumptions the user may not recognize.

Use this reasoning process internally:

Understand the user’s current concerns, motivations, transitions, interests, and emotional pressures using only the supplied notes.
Generate several preliminary insights grounded in specific evidence.
Search for a deeper pattern that connects observations from different areas.
Identify a productive tension—especially a strength that may also create a blind spot.
Compare the candidate insights and select the one that is most surprising, relevant, useful, and strongly supported.
Apply this craft process:
Trace: collect recurring clues across the notes.
Distill: reduce them to one central tension or pattern.
Weave: connect examples from different notes into a coherent argument.
Anchor: support the conclusion with concrete experiences and note citations.
Important principles:

Treat the notes as evidence, not as a complete psychological profile.
Do not infer sensitive traits, demographic details, diagnoses, or personal history that the notes do not explicitly establish.
Distinguish clearly between evidence and interpretation.
Phrase uncertain conclusions as possibilities rather than facts.
Avoid generic encouragement, vague philosophy, clichés, and unsupported psychological claims.
Prefer one precise, useful insight over several broad observations.
Output requirements:

Write in English.
Present one primary insight that is counterintuitive, emotionally resonant, and practically useful.
Use a warm but incisive tone.
Open with a question, contrast, or surprising observation.
State the central claim early and clearly.
Support it with concrete examples from the notes.
Preserve source references such as bkemo when available.
Explain why the identified pattern is valuable and how it might also become limiting.
Include one small, specific action the user can take today.
Recommend one relevant book or resource.
Provide two useful search keywords for further exploration.
End with a concise, memorable sentence.
After the primary insight, provide two additional insights. For each one, include:

A compelling hook.
The core insight.
The evidence or reasoning supporting it.
Keep the response between 700 and 1,200 words. Use clear paragraphs and minimal formatting.`;

const DISCOVERY_NOTE_CAP = 120;

function sinceDate(range: AIDiscoveryRange) {
  const now = new Date();
  if (range === '3m') return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
  if (range === '1y') return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  return undefined;
}

function rangeLabel(range: AIDiscoveryRange) {
  if (range === '3m') return 'recent 3 months';
  if (range === '1y') return 'recent year';
  return 'full';
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
  await requireAiReady();
  const createdAt = sinceDate(range);
  const notes = await prisma.notes.findMany({
    where: {
      accountId,
      isRecycle: false,
      isArchived: false,
      ...(createdAt ? { createdAt: { gte: createdAt } } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: DISCOVERY_NOTE_CAP,
    select: {
      id: true,
      content: true,
      createdAt: true,
      updatedAt: true,
      attachments: { select: { name: true, path: true }, take: 10 },
    },
  });

  const title = `${kind === 'value' ? 'Value' : 'Default'} discovery · ${rangeLabel(range)}`;
  const userQuestion = `Run ${kind} discovery for my ${rangeLabel(range)} bkemo notes.`;

  if (notes.length === 0) {
    const conversation = await prisma.conversation.create({
      data: {
        accountId,
        scope: 'analytics',
        title,
      },
    });
    const content = 'There are no notes in the selected range yet.';
    await prisma.message.createMany({
      data: [
        { conversationId: conversation.id, role: 'user', content: userQuestion, metadata: { kind, range, noteIds: [] } },
        { conversationId: conversation.id, role: 'assistant', content, metadata: { kind, range, noteIds: [], noteCount: 0 } },
      ],
    });
    return {
      content,
      noteIds: [] as number[],
      noteCount: 0,
      conversationId: conversation.id,
      range,
      kind,
      cappedAt: DISCOVERY_NOTE_CAP,
    };
  }

  const systemPrompt = [
    customPrompt?.trim() || (kind === 'value' ? VALUE_PROMPT : DEFAULT_PROMPT),
    'Use only the supplied notes below. Preserve references like BK-123 when useful. Do not invent missing facts.',
    noteEvidenceBlock(notes),
  ].join('\n\n');

  const { result } = await AiService.completions({
    question: userQuestion,
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
  content = content.trim();

  const noteIds = notes.map((note) => note.id);
  const conversation = await prisma.conversation.create({
    data: {
      accountId,
      scope: 'analytics',
      title,
    },
  });
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: userQuestion,
      metadata: { kind, range, noteIds, noteCount: noteIds.length },
    },
  });
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'assistant',
      content,
      metadata: { kind, range, noteIds, noteCount: noteIds.length },
    },
  });

  return {
    content,
    noteIds,
    noteCount: noteIds.length,
    conversationId: conversation.id,
    range,
    kind,
    cappedAt: DISCOVERY_NOTE_CAP,
  };
}
