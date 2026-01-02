/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT */
// This service worker adds Cross-Origin Isolation headers to enable SharedArrayBuffer
// Based on https://github.com/niccokunzmann/coi-serviceworker

if (typeof window === 'undefined') {
  // Service Worker context
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

  // Paths that should NOT get COEP headers (need YouTube embeds)
  const excludedPaths = ['/countdown/', '/media-player/', '/youtube/'];

  self.addEventListener('fetch', function (event) {
    const request = event.request;
    const url = new URL(request.url);

    // Only handle same-origin requests to avoid issues with CDN resources
    if (request.mode === 'navigate') {
      // Check if this path should be excluded from COEP
      const shouldExclude = excludedPaths.some((path) => url.pathname.startsWith(path));

      if (shouldExclude) {
        // Don't modify headers for excluded paths
        return;
      }

      event.respondWith(
        fetch(request)
          .then((response) => {
            // Clone the response to modify headers
            const newHeaders = new Headers(response.headers);
            newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
            newHeaders.set('Cross-Origin-Embedder-Policy', 'credentialless');

            return new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers: newHeaders
            });
          })
          .catch((err) => {
            console.error('Service worker fetch error:', err);
            return fetch(request);
          })
      );
    }
  });
} else {
  // Window context - register the service worker
  (function () {
    const reloadedKey = 'coi-serviceworker-reloaded';

    // Debug mode: disable auto-reload via URL param (?coi-debug=1) or localStorage
    // Useful for debugging when you don't want the page to auto-reload
    const urlParams = new URLSearchParams(window.location.search);
    const debugMode =
      urlParams.get('coi-debug') === '1' || localStorage.getItem('coi-debug') === '1';

    if (debugMode) {
      console.log('COI Service Worker: Debug mode enabled (auto-reload disabled)');
      console.log(
        'To disable: remove ?coi-debug=1 from URL or run: localStorage.removeItem("coi-debug")'
      );
    }

    // Check if we need cross-origin isolation
    if (window.crossOriginIsolated) {
      console.log('✓ Cross-origin isolated - SharedArrayBuffer available');
      return;
    }

    // Check if service workers are supported
    if (!('serviceWorker' in navigator)) {
      console.warn('Service workers not supported - SharedArrayBuffer unavailable');
      return;
    }

    // Register the service worker
    const currentScript = document.currentScript;
    const scriptPath = currentScript ? currentScript.src : '/coi-serviceworker.js';

    navigator.serviceWorker
      .register(scriptPath)
      .then((registration) => {
        console.log('COI Service Worker registered:', registration.scope);

        // If already active, check if we need to reload
        if (registration.active && !window.crossOriginIsolated) {
          // Only reload once to avoid infinite loop (skip in debug mode)
          if (!sessionStorage.getItem(reloadedKey) && !debugMode) {
            sessionStorage.setItem(reloadedKey, 'true');
            console.log('Reloading to enable cross-origin isolation...');
            window.location.reload();
          } else if (!debugMode) {
            console.warn('Cross-origin isolation still not enabled after reload');
          }
        }

        // Listen for the service worker to become active
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'activated' && !window.crossOriginIsolated) {
              if (!sessionStorage.getItem(reloadedKey) && !debugMode) {
                sessionStorage.setItem(reloadedKey, 'true');
                console.log('Service worker activated, reloading...');
                window.location.reload();
              }
            }
          });
        });
      })
      .catch((err) => {
        console.error('COI Service Worker registration failed:', err);
      });
  })();
}
