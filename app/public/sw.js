// Retire the legacy service worker that cached the app shell at /sw.js.
// Keep this stable URL available so browsers controlled by old releases can
// recover and load the versioned worker registered by the current app shell.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();

    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));

    await self.registration.unregister();

    const windowClients = await self.clients.matchAll({ type: 'window' });
    await Promise.all(windowClients.map((client) => client.navigate(client.url)));
  })());
});
