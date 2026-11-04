/*
 * Service worker — conservative app-shell cache.
 *
 * Deliberately minimal so it can never break the chat path:
 *   - Only intercepts GET requests to the SAME origin (the client's own assets).
 *   - Never intercepts cross-origin requests (sophia.truesight.me, etc.).
 *   - Never intercepts POST (message / upload calls pass straight through).
 *   - Network-first with cache fallback, so a stale shell is never served when
 *     the origin is reachable.
 */
const CACHE = 'sophia-client-v1';
const SHELL = [
  './',
  './index.html',
  './config.json',
  './manifest.json',
  './css/styles.css',
  './js/crypto.js',
  './js/channels.js',
  './js/auth.js',
  './js/chat.js',
  './js/app.js',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never touch POSTs (chat/upload)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin (Sophia API)

  event.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp && resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, clone));
        }
        return resp;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
