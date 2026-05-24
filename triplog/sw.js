/* eslint-disable no-restricted-globals */
/**
 * Trip Log service worker.
 *
 * Two jobs:
 *
 *  1. **Be the PWA's worker.** A registered service worker is one of
 *     Chrome's install-heuristic requirements (along with a manifest
 *     and HTTPS), and an installed PWA on Android gets noticeably more
 *     leeway in the background than a plain tab. We cache the app
 *     shell on install so a cold offline launch still paints something
 *     sensible.
 *
 *  2. **Host the recording notification.** While a trip is recording
 *     the page posts {type: 'recording-status', ...} messages to the
 *     SW; we use those to keep a persistent system notification alive
 *     ("Trip Log — recording · 0.4 mi · 8:12"). On Android the
 *     ongoing notification raises the page's process priority so the
 *     OS is less eager to suspend it, AND it gives the user a tap
 *     target that focuses the recording tab/window from the lock
 *     screen.
 *
 * Scope: `/triplog/` (registered from app.js with explicit scope).
 *
 * Notes:
 *  - Notifications need a tag so each update *replaces* the previous
 *    one instead of stacking. The tag is constant for the lifetime
 *    of a recording session.
 *  - `requireInteraction: true` keeps the notification on screen until
 *    the user dismisses it (or we clear it from `stop-recording`).
 *  - We never call `showNotification` without first checking that the
 *    page has notification permission; without it the call rejects
 *    silently on most browsers.
 */

const CACHE_NAME = 'triplog-shell-v1';

// Just the bare-minimum shell: the HTML entry plus the icon. The JS
// modules and Leaflet CDN bundle are intentionally NOT cached — they
// change often and we'd rather fetch fresh than serve a stale module
// graph that doesn't match the manifest version. The shell is enough
// to give Chrome a "yes, this is installable" tick.
const SHELL_URLS = ['/triplog/', '/triplog/index.html', '/triplog/icon.svg'];

const NOTIFICATION_TAG = 'triplog-recording';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .catch((err) => {
        console.warn('[triplog/sw] shell cache failed', err);
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((k) => k.startsWith('triplog-shell-') && k !== CACHE_NAME)
              .map((k) => caches.delete(k))
          )
        ),
      self.clients.claim()
    ])
  );
});

// Network-first for shell requests, fall back to cache when offline.
// Anything outside /triplog/ (Leaflet CDN, tiles, fonts) we pass
// straight through so the SW isn't responsible for cross-origin
// caching headaches.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith('/triplog/')) return;
  event.respondWith(
    fetch(req)
      .then((resp) => {
        // Only cache successful, basic-type responses. Range responses
        // (206) and opaque ones can't be safely revalidated.
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const clone = resp.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(req, clone))
            .catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('/triplog/')))
  );
});

/**
 * Build and display (or refresh) the ongoing recording notification.
 *
 * @param {{ title?: string, body?: string, paused?: boolean }} payload
 */
async function showRecordingNotification({ title, body, paused }) {
  if (!self.registration || typeof self.registration.showNotification !== 'function') {
    return;
  }
  try {
    await self.registration.showNotification(title || 'Trip Log — recording', {
      body: body || '',
      tag: NOTIFICATION_TAG,
      // Keep the notification on screen across updates; without this
      // Android dismisses after a few seconds and we lose the
      // foreground-importance lift.
      renotify: false,
      silent: true,
      requireInteraction: true,
      // No actions — Android limits PWAs to a couple anyway and we
      // don't have a clean way to forward the click into the page
      // when it's frozen.
      icon: '/triplog/icon-192.png',
      badge: '/triplog/icon-192.png',
      data: { kind: 'recording', paused: !!paused, ts: Date.now() }
    });
  } catch (err) {
    console.warn('[triplog/sw] showNotification failed', err);
  }
}

async function clearRecordingNotification() {
  if (!self.registration || typeof self.registration.getNotifications !== 'function') {
    return;
  }
  try {
    const list = await self.registration.getNotifications({ tag: NOTIFICATION_TAG });
    for (const n of list) {
      n.close();
    }
  } catch (err) {
    console.warn('[triplog/sw] clear notification failed', err);
  }
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'recording-status') {
    event.waitUntil(showRecordingNotification(data));
  } else if (data.type === 'stop-recording') {
    event.waitUntil(clearRecordingNotification());
  }
});

// When the user taps the recording notification, focus the existing
// Trip Log window/tab. If it's been closed entirely, open a new one
// at the recorder. matchAll/openWindow are wrapped in a try/catch in
// case the user agent locks us out (Safari sometimes does).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      try {
        const allClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true
        });
        for (const client of allClients) {
          if (client.url.includes('/triplog/') && 'focus' in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow('/triplog/');
        }
      } catch (err) {
        console.warn('[triplog/sw] notificationclick failed', err);
      }
      return null;
    })()
  );
});
