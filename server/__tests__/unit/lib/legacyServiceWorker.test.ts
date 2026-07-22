import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, test } from 'bun:test';

describe('legacy service worker retirement', () => {
  test('clears stale caches, unregisters, and reloads controlled windows', async () => {
    const workerPath = path.resolve(import.meta.dir, '../../../../app/public/sw.js');
    const workerSource = readFileSync(workerPath, 'utf8');
    const handlers = new Map<string, (event: { waitUntil(promise: Promise<unknown>): void }) => void>();
    const deletedCaches: string[] = [];
    const navigatedUrls: string[] = [];
    let skipWaitingCalls = 0;
    let claimCalls = 0;
    let unregisterCalls = 0;

    const clients = [
      { url: 'https://bk.hax429.me/', navigate: async (url: string) => navigatedUrls.push(url) },
      { url: 'https://bk.hax429.me/today', navigate: async (url: string) => navigatedUrls.push(url) },
    ];

    const serviceWorkerGlobal = {
      addEventListener: (type: string, handler: (event: { waitUntil(promise: Promise<unknown>): void }) => void) => {
        handlers.set(type, handler);
      },
      skipWaiting: async () => {
        skipWaitingCalls += 1;
      },
      clients: {
        claim: async () => {
          claimCalls += 1;
        },
        matchAll: async () => clients,
      },
      registration: {
        unregister: async () => {
          unregisterCalls += 1;
          return true;
        },
      },
    };

    vm.runInNewContext(workerSource, {
      self: serviceWorkerGlobal,
      caches: {
        keys: async () => ['workbox-precache-v2', 'api-cache', 'image-cache'],
        delete: async (cacheName: string) => {
          deletedCaches.push(cacheName);
          return true;
        },
      },
      Promise,
    });

    const installHandler = handlers.get('install');
    const activateHandler = handlers.get('activate');
    expect(installHandler).toBeDefined();
    expect(activateHandler).toBeDefined();

    let installPromise: Promise<unknown> | undefined;
    installHandler?.({ waitUntil: (promise) => { installPromise = promise; } });
    await installPromise;

    let activatePromise: Promise<unknown> | undefined;
    activateHandler?.({ waitUntil: (promise) => { activatePromise = promise; } });
    await activatePromise;

    expect(skipWaitingCalls).toBe(1);
    expect(claimCalls).toBe(1);
    expect(deletedCaches).toEqual(['workbox-precache-v2', 'api-cache', 'image-cache']);
    expect(unregisterCalls).toBe(1);
    expect(navigatedUrls).toEqual(['https://bk.hax429.me/', 'https://bk.hax429.me/today']);
  });
});
