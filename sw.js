// Service worker: red primero (para recibir siempre la última versión) y caché si no hay conexión.
const CACHE = 'firegochi-v1';
const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'src/style.css',
  'src/main.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// La página envía lo que cargó antes de que el service worker controlara la pestaña.
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'cache') return;
  const urls = (e.data.urls || []).filter((u) => new URL(u).origin === location.origin);
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(urls.map((u) => c.add(u).catch(() => {})))));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
  );
});
