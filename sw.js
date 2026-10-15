// Service worker: red primero (para recibir siempre la última versión) y caché si no hay conexión.
const CACHE = 'firegochi-v5';
const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)));
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
  if (e.data?.type === 'skip') self.skipWaiting();
  if (e.data?.type !== 'cache') return;
  const urls = (e.data.urls || []).filter((u) => new URL(u).origin === location.origin);
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(urls.map((u) => c.add(u).catch(() => {})))));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  const page = req.mode === 'navigate';
  e.respondWith(
    fetch(req, { cache: 'no-store' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      // Sin conexión: cada script se busca con su versión exacta para no mezclar archivos de versiones distintas.
      .catch(() => caches.match(req, { ignoreSearch: page }).then((hit) => hit || (page ? caches.match('index.html') : Response.error())))
  );
});
