// Service worker: makes the app work offline and handles updates (PLAN §12.4).
// Bump VERSION on every push that changes any file in PRECACHE (npm run check enforces it).
const VERSION = '0.2.0';
const CACHE = `deutsch-v${VERSION}`;

const PRECACHE = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'db.js',
  'grading.js',
  'srs.js',
  'session.js',
  'cards.js',
  'tts.js',
  'strings.nl.js',
  'vendor/ts-fsrs.js',
  'manifest.json',
  'fonts/atkinson-400.woff2',
  'fonts/atkinson-700.woff2',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'words/words-0001-0500.json',
];

self.addEventListener('install', (event) => {
  // `cache: 'reload'` skips the browser's HTTP cache, so a new version never precaches old files.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))),
  );
  // No skipWaiting here: the new version waits until the owner taps "Update beschikbaar"
  // or all windows are closed, so it never switches mid-session.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('deutsch-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'GET_VERSION') event.ports[0]?.postMessage(VERSION);
});

// Cache-first for the app's own files; everything else goes to the network.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('index.html');
      if (shell) return shell;
    }
    return fetch(req);
  })());
});
