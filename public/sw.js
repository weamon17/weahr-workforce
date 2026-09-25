const CACHE_VERSION = 'weahr-shell-v1';
const APP_SHELL = [
  '/',
  '/offline.html',
  '/manifest.webmanifest',
  '/wea-hr-icon.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL)),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('weahr-shell-') && key !== CACHE_VERSION)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put('/', copy));
          return response;
        })
        .catch(async () => (await caches.match('/')) || caches.match('/offline.html')),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')
    || url.pathname.endsWith('.svg')
    || url.pathname.endsWith('.png')
    || url.pathname.endsWith('.webmanifest')) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(response => {
        if (!response.ok) return response;
        const copy = response.clone();
        caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
        return response;
      })),
    );
  }
});
