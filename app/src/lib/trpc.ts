import { createTRPCClient, httpBatchLink, httpLink, splitLink, httpBatchStreamLink } from '@trpc/client';
import type { AppRouter } from '../../../server/routerTrpc/_app';
import superjson from 'superjson';
import { getBlinkoEndpoint } from './blinkoEndpoint';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';
const headers = () => {
  const userStore = RootStore.Get(UserStore);
  const token = userStore.token;
  const baseHeaders: Record<string, string> = {};

  if (token) {
    baseHeaders['Authorization'] = `Bearer ${token}`;
  }

  return baseHeaders;
};


/** Batch/mutation timeout (uploads). Streaming AI chats use a longer budget. */
const TRPC_BATCH_TIMEOUT_MS = 5 * 60 * 1000;
const TRPC_STREAM_TIMEOUT_MS = 15 * 60 * 1000;

function timedFetch(timeoutMs: number) {
  return (url: RequestInfo | URL, options?: RequestInit) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const incoming = options?.signal;
    let signal: AbortSignal = timeout;
    if (incoming) {
      if (typeof AbortSignal.any === 'function') {
        signal = AbortSignal.any([timeout, incoming]);
      } else {
        // Fallback: prefer timeout; callers rarely pass their own signal here.
        signal = timeout;
      }
    }
    return fetch(url, { ...options, signal });
  };
}

const getLinks = (useStream = false) => {
  try {
    if (useStream) {
      return httpBatchStreamLink({
        url: getBlinkoEndpoint('/api/trpc'),
        transformer: superjson,
        headers,
        // AI chat streams can idle during provider TTFT; 5m was aborting as BodyStreamBuffer.
        fetch: timedFetch(TRPC_STREAM_TIMEOUT_MS),
      });
    }

    return splitLink({
      condition(op) {
        return op.context.skipBatch === true;
      },
      true: httpLink({
        url: getBlinkoEndpoint('/api/trpc'),
        transformer: superjson,
        headers,
        fetch: timedFetch(TRPC_BATCH_TIMEOUT_MS),
      }),
      // when condition is false, use batching
      false: httpBatchLink({
        url: getBlinkoEndpoint('/api/trpc'),
        transformer: superjson,
        headers,
        fetch: timedFetch(TRPC_BATCH_TIMEOUT_MS),
      }),
    });
  } catch (error) {
    console.error(error, 'trpc get links error');
    return splitLink({
      condition(op) {
        return op.context.skipBatch === true;
      },
      true: httpLink({
        url: ('/api/trpc'),
        transformer: superjson,
        headers,
        fetch: timedFetch(TRPC_BATCH_TIMEOUT_MS),
      }),
      // when condition is false, use batching
      false: httpBatchLink({
        url: ('/api/trpc'),
        transformer: superjson,
        headers,
        fetch: timedFetch(TRPC_BATCH_TIMEOUT_MS),
      }),
    });;
  }
};

//@ts-ignore
export let api = createTRPCClient<AppRouter>({
  links: [getLinks(false)],
});

//@ts-ignore
export let streamApi = createTRPCClient<AppRouter>({
  links: [getLinks(true)],
});

/**
 * refresh api
 * when need refresh auth status (login/logout)
 */
export const reinitializeTrpcApi = () => {
  //@ts-ignore
  api = createTRPCClient<AppRouter>({
    links: [getLinks(false)],
  });

  //@ts-ignore
  streamApi = createTRPCClient<AppRouter>({
    links: [getLinks(true)],
  });

  return { api, streamApi };
};

