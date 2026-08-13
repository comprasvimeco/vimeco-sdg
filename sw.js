// Versión reemplazada automáticamente por build.js en cada push (GitHub Actions)
const CACHE_NAME = 'vimeco-sdg-v1786623756905';

const BASE = '/vimeco-sdg';

const STATIC_ASSETS = [
  BASE + '/index.html',
  BASE + '/app.html',
  BASE + '/css/styles.css',
  BASE + '/js/config.js',
  BASE + '/js/firebase.js',
  BASE + '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(
        STATIC_ASSETS.map(url => cache.add(url).catch(() => {}))
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Network-only: Firebase y APIs de Google — nunca cachear.
  if (url.hostname.endsWith('.googleapis.com') || url.hostname.endsWith('.firebaseio.com')) {
    return;
  }

  if (event.request.method !== 'GET') return;

  const sameOrigin = url.origin === self.location.origin;
  const path       = url.pathname;

  // Código de la app (HTML, JS, CSS, JSON) y navegaciones → network-first:
  // siempre trae lo último cuando hay red, cae a caché si no hay conexión.
  const appCode = sameOrigin &&
    (event.request.mode === 'navigate' || /\.(html|js|css|json)$/i.test(path));

  if (appCode) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(response => {
          if (response && response.status === 200 && response.type !== 'opaque') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request, { ignoreSearch: true }))
    );
    return;
  }

  // Resto (assets pesados, terceros cacheables) → cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
