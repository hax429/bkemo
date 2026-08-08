import { vi } from 'vitest';

type QueryFn = (...args: unknown[]) => unknown;
type MutateFn = (...args: unknown[]) => unknown;

/** Minimal tRPC-shaped stub for UI tests that only touch a few procedures. */
export function mockAccessTokenApi(overrides: {
  list?: QueryFn;
  misuseIncidents?: QueryFn;
  create?: MutateFn;
  revoke?: MutateFn;
  dismissMisuse?: MutateFn;
} = {}) {
  return {
    accessTokens: {
      list: { query: vi.fn(overrides.list ?? (async () => [])) },
      misuseIncidents: { query: vi.fn(overrides.misuseIncidents ?? (async () => [])) },
      create: { mutate: vi.fn(overrides.create ?? (async () => ({ token: 'x', name: 't' }))) },
      revoke: { mutate: vi.fn(overrides.revoke ?? (async () => undefined)) },
      dismissMisuse: { mutate: vi.fn(overrides.dismissMisuse ?? (async () => undefined)) },
    },
    oauth: {
      connections: { query: vi.fn(async () => []) },
    },
  };
}
