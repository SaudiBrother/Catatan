/* ==========================================================================
   CATAT — sw.js  (Service Worker)
   Strategy: Cache-first for app shell assets, network-first for fresh data.
   All user data lives in IndexedDB (never in Cache Storage) so there is no
   risk of cached sensitive content in the service worker cache.
   ========================================================================== */

const CACHE_VERSION = 'catat-v1.0.0';

/* Assets that form the app shell — cached on install and served offline */
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css',
  './css/themes.css',
  './css/components.css',
  './css/animations.css',
  './js/main.js',
  './js/db.js',
  './js/ui.js',
  './js/views.js',
  './js/editor.js',
  './js/attachments.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon-16.png',
];

/* External CDN resources loaded lazily — we cache them on first use */
const CDN_PATTERN = /cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net/;

/* ── Install: pre-cache shell ── */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_ASSETS).catch((err) => {
      /* Non-fatal: some icon sizes may not exist during development */
      console.warn('[SW] Pre-cache partial failure:', err);
    }))
  );
  self.skipWaiting();
});

/* ── Activate: purge stale caches ── */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch: cache-first for shell, stale-while-revalidate for CDN ── */
self.addEventListener('fetch', (e) => {
  const { request } = e;

  /* Ignore non-GET, chrome-extension, and cross-origin API requests */
  if (request.method !== 'GET') return;
  if (request.url.startsWith('chrome-extension')) return;
  if (request.url.includes('anthropic.com')) return; /* never cache API calls */

  /* CDN resources: stale-while-revalidate */
  if (CDN_PATTERN.test(request.url)) {
    e.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(request);
        const fetchPromise = fetch(request).then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        }).catch(() => null);
        return cached || fetchPromise;
      })
    );
    return;
  }

  /* App shell & local assets: cache-first with network fallback */
  e.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (!res.ok || res.type === 'opaque') return res;
        return caches.open(CACHE_VERSION).then((cache) => {
          cache.put(request, res.clone());
          return res;
        });
      }).catch(() => {
        /* Offline fallback: return index.html for navigation requests */
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});

/* ── Background sync (optional, for reminder notifications while closed) ── */
self.addEventListener('sync', (e) => {
  if (e.tag === 'catat-reminders') {
    /* Notify clients to run their reminder check */
    e.waitUntil(notifyClients());
  }
});
async function notifyClients() {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach((c) => c.postMessage({ type: 'CHECK_REMINDERS' }));
}

/* ── Push notifications (if ever backend is added) ── */
self.addEventListener('push', (e) => {
  if (!e.data) return;
  const data = e.data.json();
  e.waitUntil(
    self.registration.showNotification(data.title || 'Catat', {
      body: data.body || '',
      icon: './icons/icon-192.png',
      badge: './icons/favicon-32.png',
      tag: data.tag || 'catat',
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow('./');
    })
  );
});
