// Cortex Clash — offline cache (PWA)
// Bump the version when you change game files so clients pick up the update.
const CACHE = 'cortex-clash-v4';
const APP_SHELL = [
  '.',
  'index.html',
  'manifest.webmanifest',
  'game/sound.js',
  'game/boards.js',
  'game/engine.js',
  'game/net.js',
  'game/render.js',
  'game/ai.js',
  'game/main.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'screenshots/narrow.png',
  'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
  'https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      await c.addAll(APP_SHELL.filter((u) => !u.startsWith('http')));
      // CDN assets: best effort — app must still install without network luck
      for (const u of APP_SHELL.filter((x) => x.startsWith('http'))) {
        try { await c.add(u); } catch (err) { /* fetched lazily later */ }
      }
      self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// cache-first, then network; successful GETs are added to the cache
// (this also picks up the woff2 font files Google Fonts CSS points at)
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: false }).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match('index.html'));
    })
  );
});
