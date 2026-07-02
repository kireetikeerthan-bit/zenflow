/**
 * ZenFlow v6 — Service Worker
 * Handles: offline caching, background sync, push notifications
 * Strategy: Cache-first for app shell, network-first for fresh content
 */

const CACHE_NAME = 'zenflow-v6';
const CACHE_VERSION = '6.0.0';

// All resources that make up the app shell
const APP_SHELL = [
  '/zenflow/',
  '/zenflow/index.html',
  '/zenflow/manifest.json',
  '/zenflow/icons/icon-192.png',
  '/zenflow/icons/icon-512.png',
  // External fonts and icons — cached on first load
  'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Inter:wght@300;400;500;600&display=swap',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/dist/tabler-icons.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js'
];

// ── INSTALL: cache the app shell immediately ──
self.addEventListener('install', event => {
  console.log('[ZenFlow SW] Installing v' + CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[ZenFlow SW] Caching app shell');
        // Cache local files strictly, external ones softly (don't fail install if CDN is slow)
        const localFiles = APP_SHELL.filter(url => !url.startsWith('http'));
        const externalFiles = APP_SHELL.filter(url => url.startsWith('http'));
        return cache.addAll(localFiles).then(() => {
          return Promise.allSettled(
            externalFiles.map(url =>
              cache.add(url).catch(err => console.warn('[ZenFlow SW] Could not cache:', url, err))
            )
          );
        });
      })
      .then(() => self.skipWaiting()) // activate immediately, don't wait
  );
});

// ── ACTIVATE: clean up old caches ──
self.addEventListener('activate', event => {
  console.log('[ZenFlow SW] Activating v' + CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('[ZenFlow SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim()) // take control of all open tabs immediately
  );
});

// ── FETCH: serve from cache, fall back to network ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET requests and browser extension requests
  if (event.request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;
  if (url.protocol === 'moz-extension:') return;

  // For font/icon CDN requests: cache-first (they never change)
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('jsdelivr.net') ||
    url.hostname.includes('cloudflare.com')
  ) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        }).catch(() => {
          // CDN unavailable — icons and fonts just won't show, app still works
          return new Response('', { status: 503 });
        });
      })
    );
    return;
  }

  // For app shell (index.html, manifest, icons): cache-first, update in background
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached); // If network fails, use cache

      // Return cached immediately, update in background
      return cached || networkFetch;
    })
  );
});

// ── PUSH NOTIFICATIONS (for future server-side alerts) ──
self.addEventListener('push', event => {
  let data = { title: 'ZenFlow', body: 'Your task is ready.' };
  try {
    if (event.data) data = event.data.json();
  } catch(e) {}

  event.waitUntil(
    self.registration.showNotification(data.title || 'ZenFlow', {
      body: data.body || 'Time to focus.',
      icon: '/zenflow/icons/icon-192.png',
      badge: '/zenflow/icons/icon-96.png',
      vibrate: [100, 50, 100],
      tag: 'zenflow-task',
      renotify: true,
      data: { url: '/zenflow/' }
    })
  );
});

// ── NOTIFICATION CLICK: open the app ──
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // If app is already open, focus it
      for (const client of clientList) {
        if (client.url.includes('/zenflow/') && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow('/zenflow/');
      }
    })
  );
});

// ── BACKGROUND SYNC (when connectivity returns) ──
self.addEventListener('sync', event => {
  if (event.tag === 'zenflow-sync') {
    console.log('[ZenFlow SW] Background sync triggered');
    // ZenFlow uses localStorage, no server sync needed currently
    // This hook is here for future cloud backup features
  }
});

console.log('[ZenFlow SW] Service Worker loaded — ZenFlow v' + CACHE_VERSION);
