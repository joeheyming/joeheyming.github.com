/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT */
// This service worker adds Cross-Origin Isolation headers to enable SharedArrayBuffer
// Based on https://github.com/niccokunzmann/coi-serviceworker

if (typeof window === 'undefined') {
  // Service Worker context
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

  // Header injection strategy:
  //
  //   - Navigation responses (the top-level HTML document): must carry
  //     Cross-Origin-Opener-Policy AND Cross-Origin-Embedder-Policy to
  //     elevate the document to a cross-origin-isolated browsing context.
  //     This is what makes window.crossOriginIsolated === true and enables
  //     SharedArrayBuffer.
  //
  //   - Subresource responses (scripts, workers, fetch(), importScripts):
  //     Emscripten pthread builds spawn a Web Worker via `new Worker(url)`,
  //     and in a COEP parent the WORKER SCRIPT RESPONSE must itself satisfy
  //     COEP — otherwise the worker silently fails to spawn and the runtime
  //     hangs forever on addRunDependency("loading-workers") without an
  //     observable error. The upstream uzdoom-wasm Caddy config sets COOP /
  //     COEP / CORP on every response; we mirror that here for same-origin
  //     subresources so the COI contract holds across the whole subtree.
  //
  // Cross-origin subresources (YouTube iframes, shared CDN scripts) are NOT
  // rewritten here. In 'credentialless' mode the browser fetches them
  // without credentials and won't block the page, so most embeds keep
  // working unchanged.
  self.addEventListener('fetch', function (event) {
    const request = event.request;
    if (request.method !== 'GET') return;

    let requestURL;
    try {
      requestURL = new URL(request.url);
    } catch (_) {
      return;
    }

    if (requestURL.origin !== self.location.origin) return;

    // Never intercept blob: or data: URLs — the browser handles them
    // natively and wrapping their response body in a new Response can
    // break consumers (e.g. EmulatorJS fetching blob ROM URLs).
    if (requestURL.protocol === 'blob:' || requestURL.protocol === 'data:') return;

    event.respondWith(
      fetch(request)
        .then((response) => {
          const newHeaders = new Headers(response.headers);

          if (request.mode === 'navigate') {
            newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
            newHeaders.set('Cross-Origin-Embedder-Policy', 'credentialless');
          } else {
            // Subresources (incl. Worker scripts): embeddable under COEP
            // credentialless + their own response carries COEP so spawned
            // Workers inherit an isolated context.
            newHeaders.set('Cross-Origin-Embedder-Policy', 'credentialless');
            newHeaders.set('Cross-Origin-Resource-Policy', 'same-origin');
          }

          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders
          });
        })
        .catch((err) => {
          console.error('[coi-sw] fetch error:', err);
          return fetch(request);
        })
    );
  });
} else {
  // Window context - register the service worker
  (function () {
    // Bootstrap race to watch for: on first visit the SW registers and hits
    // 'activated', then calls clients.claim(). But the page was fetched from
    // the network BEFORE the SW was the controller, so no COI headers made
    // it through. Reloading right after 'activated' is still racy — the
    // reload may dispatch before the client is actually under SW control,
    // and the reload goes to network again. The reliable signal is the
    // 'controllerchange' event on navigator.serviceWorker: that fires when
    // the SW is bound as this client's controller. Only reload after that.
    //
    // Allow up to 3 reload attempts (counted in sessionStorage) so that a
    // truly broken setup fails loud instead of infinite-looping.
    const attemptsKey = 'coi-serviceworker-attempts';
    const MAX_ATTEMPTS = 3;

    const urlParams = new URLSearchParams(window.location.search);
    const debugMode =
      urlParams.get('coi-debug') === '1' || localStorage.getItem('coi-debug') === '1';

    if (debugMode) {
      console.log('COI Service Worker: Debug mode enabled (auto-reload disabled)');
    }

    if (window.crossOriginIsolated) {
      sessionStorage.removeItem(attemptsKey);
      document.documentElement.classList.remove('coi-pending');
      console.log('✓ Cross-origin isolated - SharedArrayBuffer available');
      return;
    }

    if (!('serviceWorker' in navigator)) {
      console.warn('Service workers not supported - SharedArrayBuffer unavailable');
      return;
    }

    const currentScript = document.currentScript;
    const scriptPath = currentScript ? currentScript.src : '/coi-serviceworker.js';

    const attempt = parseInt(sessionStorage.getItem(attemptsKey) || '0', 10);

    function scheduleReload(reason) {
      if (debugMode) return;
      if (attempt >= MAX_ATTEMPTS) {
        console.warn(
          'COI: crossOriginIsolated still false after ' +
            attempt +
            ' reload(s). ' +
            'SharedArrayBuffer will be unavailable on this page.'
        );
        // Clear the counter so the next navigation is not trapped in
        // this branch. A manual refresh is what actually gets the active
        // worker controlling the document, so do that once ourselves.
        // doom/coi.js uses the same key and shows the error card if the
        // recovery navigation is still not isolated.
        sessionStorage.removeItem(attemptsKey);
        if (!debugMode && sessionStorage.getItem('coi-recover-reload') !== '1') {
          sessionStorage.setItem('coi-recover-reload', '1');
          console.log('COI: reloading (recover)');
          window.location.reload();
          return;
        }
        document.documentElement.classList.remove('coi-pending');
        return;
      }
      sessionStorage.setItem(attemptsKey, String(attempt + 1));
      console.log(
        'COI: reloading (' + reason + ', attempt ' + (attempt + 1) + '/' + MAX_ATTEMPTS + ')'
      );
      window.location.reload();
    }

    // Wait for the SW to actually become *this client's* controller before
    // triggering a reload. 'controllerchange' fires when navigator.
    // serviceWorker.controller flips from null to non-null. If the SW is
    // already the controller at script run time, reload is safe now.
    function waitForController(timeoutMs) {
      return new Promise(function (resolve) {
        if (navigator.serviceWorker.controller) {
          resolve('already-controlling');
          return;
        }
        var done = false;
        var timer = setTimeout(function () {
          if (done) return;
          done = true;
          resolve('timeout');
        }, timeoutMs);
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          function () {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve('controllerchange');
          },
          { once: true }
        );
      });
    }

    navigator.serviceWorker
      .register(scriptPath)
      .then(function (registration) {
        console.log('COI Service Worker registered:', registration.scope);

        // Hard reload (Cmd+Shift+R / Ctrl+Shift+R) bypasses the SW for
        // the navigation, so the document has no COOP/COEP and
        // crossOriginIsolated is false even though the SW is registered
        // and active from a previous session. Waiting for 'controller-
        // change' is pointless in that state: the SW won't go through a
        // new install/activate cycle, so clients.claim() won't fire
        // again and the event will never come. One normal reload puts
        // the active worker in control. Reloading again while we are
        // still uncontrolled just burns the attempt budget and strands
        // the page on the error card; a later manual refresh works.
        if (
          attempt === 0 &&
          registration.active &&
          !navigator.serviceWorker.controller &&
          !window.crossOriginIsolated
        ) {
          scheduleReload('hard-reload-bypass');
          return null;
        }

        return waitForController(5000);
      })
      .then(function (reason) {
        if (reason === null) return; // scheduleReload already fired
        if (!window.crossOriginIsolated) {
          scheduleReload(reason);
        } else {
          sessionStorage.removeItem(attemptsKey);
          document.documentElement.classList.remove('coi-pending');
          console.log('✓ Cross-origin isolated');
        }
      })
      .catch(function (err) {
        console.error('COI Service Worker registration failed:', err);
      });
  })();
}
