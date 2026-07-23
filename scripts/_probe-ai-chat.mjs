/**
 * Red/green probe for ai.chat stuck on Thinking / no assistant deltas.
 * GREEN: receives at least one text delta OR a non-empty assistantMessage within timeout.
 * Usage: bun scripts/_probe-ai-chat.mjs
 */
import { PrismaClient } from '@prisma/client';
import { createTRPCClient, httpBatchStreamLink } from '@trpc/client';
import superjson from 'superjson';

const BASE = process.env.BKEMO_BASE || 'http://127.0.0.1:1111';
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 60000);
const prisma = new PrismaClient();

async function main() {
  const account = await prisma.accounts.findFirst({ orderBy: { id: 'asc' } });
  if (!account?.apiToken) {
    console.log('RESULT: RED no apiToken on first account');
    process.exit(2);
  }

  const withRAG = process.argv.includes('--rag');
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

  const started = Date.now();
  let deltas = 0;
  let deltaChars = 0;
  let sawConversation = false;
  let assistantLen = 0;
  let lastEventKeys = [];
  let error = null;

  const timer = setTimeout(() => {
    error = new Error(`timeout after ${TIMEOUT_MS}ms`);
  }, TIMEOUT_MS);

  try {
    const stream = await client.ai.chat.mutate({
      question: `Probe ${Date.now()}: reply with exactly the word pong.`,
      scope: 'global',
      contextNoteIds: [],
      withOnline: false,
      withRAG,
    });

    for await (const event of stream) {
      if (error) throw error;
      lastEventKeys = Object.keys(event || {});
      if (event?.conversation?.id) sawConversation = true;
      if (typeof event?.delta === 'string' && event.delta.length) {
        deltas += 1;
        deltaChars += event.delta.length;
        process.stdout.write(event.delta);
      }
      if (event?.assistantMessage?.content != null) {
        assistantLen = String(event.assistantMessage.content).length;
      }
      if (event?.chunk) {
        // legacy completions shape — count as signal
        deltas += 1;
      }
    }
  } catch (cause) {
    error = cause;
  } finally {
    clearTimeout(timer);
    await prisma.$disconnect();
  }

  console.log('\n---');
  console.log({
    withRAG,
    ms: Date.now() - started,
    sawConversation,
    deltas,
    deltaChars,
    assistantLen,
    lastEventKeys,
    error: error ? String(error?.message || error) : null,
  });

  const ok = !error && (deltaChars > 0 || assistantLen > 0);
  // Exact user symptom: stream ends or hangs without assistant text → stuck Thinking / empty reply
  if (ok) {
    console.log('RESULT: GREEN got assistant stream content');
    process.exit(0);
  }
  console.log('RESULT: RED no assistant content (Thinking / silent AI)');
  process.exit(1);
}

main();
