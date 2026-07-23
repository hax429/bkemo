/**
 * Latency breakdown for ai.chat.
 * RED if time-to-first-delta > FIRST_MS or total > TOTAL_MS (defaults generous).
 * Usage: bun scripts/_probe-ai-latency.mjs [--rag|--no-rag] [--question "..."]
 */
import { PrismaClient } from '@prisma/client';
import { createTRPCClient, httpBatchStreamLink } from '@trpc/client';
import superjson from 'superjson';

const BASE = process.env.BKEMO_BASE || 'http://127.0.0.1:1111';
const FIRST_MS = Number(process.env.PROBE_FIRST_MS || 8000);
const TOTAL_MS = Number(process.env.PROBE_TOTAL_MS || 30000);
const withRAG = !process.argv.includes('--no-rag');
const qIdx = process.argv.indexOf('--question');
const question = qIdx >= 0
  ? process.argv[qIdx + 1]
  : 'Reply with exactly the word pong and nothing else.';

const prisma = new PrismaClient();

async function main() {
  const account = await prisma.accounts.findFirst({ orderBy: { id: 'asc' } });
  if (!account?.apiToken) {
    console.log('RESULT: RED no apiToken');
    process.exit(2);
  }

  // Config snapshot
  const models = await prisma.aiModels.findMany({ include: { provider: true } });
  const configs = await prisma.config.findMany();
  const aiCfg = Object.fromEntries(configs.filter(c => /ai|embed|model/i.test(c.key)).map(c => [c.key, c.config]));
  console.log('config', {
    withRAG,
    models: models.map(m => ({
      id: m.id,
      title: m.title,
      provider: m.provider?.provider,
      baseURL: m.provider?.baseURL,
      caps: m.capabilities,
    })),
    aiCfgKeys: Object.keys(aiCfg),
    mainModel: aiCfg.mainModel ?? aiCfg.aiModel ?? aiCfg.mainAIModelId ?? aiCfg.aiMainModelId,
    embeddingModel: aiCfg.embeddingModel ?? aiCfg.embeddingModelId,
  });

  const client = createTRPCClient({
    links: [
      httpBatchStreamLink({
        url: `${BASE}/api/trpc`,
        transformer: superjson,
        headers() {
          return { Authorization: `Bearer ${account.apiToken}` };
        },
      }),
    ],
  });

  const t0 = Date.now();
  let tFirstYield = null;
  let tFirstDelta = null;
  let tDone = null;
  let deltas = 0;
  let chars = 0;
  let status = null;
  let notesCount = null;
  let error = null;
  let text = '';

  try {
    const stream = await client.ai.chat.mutate({
      question,
      scope: 'global',
      contextNoteIds: [],
      withOnline: false,
      withRAG,
    });
    for await (const event of stream) {
      const now = Date.now();
      if (tFirstYield == null) tFirstYield = now - t0;
      if (event?.status) status = event.status;
      if (event?.notes) notesCount = Array.isArray(event.notes) ? event.notes.length : null;
      if (typeof event?.delta === 'string' && event.delta.length) {
        if (tFirstDelta == null) tFirstDelta = now - t0;
        deltas += 1;
        chars += event.delta.length;
        text += event.delta;
      }
      if (event?.done || event?.assistantMessage) tDone = now - t0;
    }
  } catch (e) {
    error = String(e?.message || e);
  } finally {
    await prisma.$disconnect();
  }

  const total = tDone ?? (Date.now() - t0);
  const report = {
    withRAG,
    question,
    ms: {
      firstYield: tFirstYield,
      firstDelta: tFirstDelta,
      total,
      preFirstDelta: tFirstDelta,
    },
    deltas,
    chars,
    notesCount,
    status,
    textPreview: text.slice(0, 120),
    error,
    thresholds: { FIRST_MS, TOTAL_MS },
  };
  console.log(JSON.stringify(report, null, 2));

  const slowFirst = tFirstDelta == null || tFirstDelta > FIRST_MS;
  const slowTotal = total > TOTAL_MS;
  if (error) {
    console.log('RESULT: RED error');
    process.exit(1);
  }
  if (slowFirst || slowTotal) {
    console.log('RESULT: RED slow', { slowFirst, slowTotal, firstDelta: tFirstDelta, total });
    process.exit(1);
  }
  console.log('RESULT: GREEN fast enough');
  process.exit(0);
}

main();
