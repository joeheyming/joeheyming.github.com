// Legend of DOOM — cross-origin isolation (COI) subsystem.
//
// UZDoom spins up pthread Web Workers and transfers a SharedArrayBuffer
// into them during instantiation. That postMessage call throws
// DataCloneError unless `self.crossOriginIsolated` is true, which
// requires COOP: same-origin + COEP: credentialless (or require-corp)
// headers on the main document plus CORP headers on every subresource.
// On GitHub Pages we don't control response headers, so we rely on
// `/coi-serviceworker.js` to install a service worker that intercepts
// fetches and injects those headers. The SW takes effect on the next
// navigation after install, which is why the first-ever visit reloads
// once before anything works.
//
// This file replaces three previously-inlined fragments in index.html:
//   1. `window.__COI_READY__ = !!crossOriginIsolated` — the "did it
//      happen?" flag probed by the script injector.
//   2. A 6-second status countdown on `#status` that ended in a red
//      error card injected into `#boot .panel`.
//   3. A separate 8-second polling loop in the script injector that
//      waited before appending engine scripts.
//
// Unification: one 8-second budget, one error surface, one promise
// (`LoDCOI.whenReady()`) that every caller can await. On failure we
// transition the lifecycle to `error{coi}` so subscribers (the hero
// button, touch overlay) can react in a single place.
//
// Depends on: lifecycle.js (optional — degrades gracefully if missing).
(function () {
  'use strict';

  var BUDGET_MS = 8000;
  var POLL_MS = 500;
  var T0 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

  var _ready = !!window.crossOriginIsolated;
  var _failed = false;
  var _waiters = [];

  function elapsed() {
    var now =
      typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    return now - T0;
  }

  function resolveAll() {
    var w = _waiters;
    _waiters = [];
    for (var i = 0; i < w.length; i++) w[i].resolve();
  }
  function rejectAll(err) {
    var w = _waiters;
    _waiters = [];
    for (var i = 0; i < w.length; i++) w[i].reject(err);
  }

  function renderCountdown() {
    var st = document.getElementById('status');
    if (!st) return;
    var remaining = Math.max(0, Math.ceil((BUDGET_MS - elapsed()) / 1000));
    st.textContent = 'Waiting for cross-origin isolation (' + remaining + 's)…';
  }

  // Classify why COI couldn't come up. The fix is different per cause,
  // and the old "open DevTools" instruction was useless on a phone (no
  // DevTools) and misleading when the real problem was that service
  // workers were never allowed to register in the first place.
  //
  // Returns one of:
  //   'insecure'  — page is served over an insecure, non-localhost
  //                 origin. Service workers require a secure context
  //                 (HTTPS or http://localhost). A LAN IP like
  //                 192.168.1.5:8000 on a phone hits this path. Nothing
  //                 the user can do from inside the page: they need
  //                 HTTPS, a tunnel, or a browser flag.
  //   'no-sw'     — secure context, but the browser has no
  //                 serviceWorker API at all (old / privacy mode / WebView
  //                 with SW disabled). Also unrecoverable from here.
  //   'sw-stuck'  — service worker is available but didn't take control
  //                 within the budget. This IS recoverable: unregister
  //                 the old SW and reload. We can do that with a button.
  function classifyCoiFailure() {
    if (window.isSecureContext === false) return 'insecure';
    if (!('serviceWorker' in navigator)) return 'no-sw';
    return 'sw-stuck';
  }

  function buildErrorBody(cause) {
    // Returns { html, showUnregisterBtn }. `html` is injected as innerHTML
    // so it needs to be trusted (it is — all strings below are literal).
    if (cause === 'insecure') {
      var origin = (window.location && window.location.origin) || '(unknown origin)';
      return {
        showUnregisterBtn: false,
        html:
          '<strong>Cross-origin isolation requires HTTPS.</strong> ' +
          'This page is served from <code>' +
          origin +
          '</code>, which is not a secure context. Service workers only ' +
          'register on HTTPS or <code>http://localhost</code> — and without ' +
          'the service worker, SharedArrayBuffer is unavailable and the ' +
          'engine cannot start its pthread workers.' +
          '<br /><br /><b>Fixes:</b>' +
          '<br />• Open this page over HTTPS (deploy it, or use a tunnel ' +
          'like <code>cloudflared tunnel --url http://localhost:PORT</code>).' +
          '<br />• On Chrome for Android, visit ' +
          '<code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code>, ' +
          'add <code>' +
          origin +
          '</code>, set to Enabled, relaunch.' +
          '<br />• Install ' +
          '<a href="https://zdoom.org/downloads" target="_blank" rel="noopener" ' +
          'style="color:#f87171">GZDoom</a> locally and run the mod natively.'
      };
    }
    if (cause === 'no-sw') {
      return {
        showUnregisterBtn: false,
        html:
          '<strong>Service workers unavailable in this browser.</strong> ' +
          'The engine needs a service worker to inject cross-origin isolation ' +
          'headers, but this browser has disabled or removed service worker ' +
          'support (common in private/incognito on some browsers, or in ' +
          'embedded WebViews).' +
          '<br /><br />Try a regular tab in Chrome, Firefox, or Safari, or ' +
          'install ' +
          '<a href="https://zdoom.org/downloads" target="_blank" rel="noopener" ' +
          'style="color:#f87171">GZDoom</a> to run the mod natively.'
      };
    }
    // sw-stuck: secure context, SW API present, just didn't claim the
    // page in time. Usually a stale registration from a previous
    // deploy — unregistering and reloading fixes it.
    return {
      showUnregisterBtn: true,
      html:
        '<strong>Cross-origin isolation failed.</strong> The service worker ' +
        "couldn't take control of this page in time, so SharedArrayBuffer " +
        'is unavailable and the engine cannot start its pthread workers.' +
        '<br /><br />This usually means a stale service worker is in the ' +
        'way. The button below unregisters it and reloads the page — ' +
        'that should fix it on the next load.' +
        "<br /><br />If reloading doesn't help, install " +
        '<a href="https://zdoom.org/downloads" target="_blank" rel="noopener" ' +
        'style="color:#f87171">GZDoom</a> locally and run the mod natively.'
    };
  }

  function wireUnregisterBtn(btn) {
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      btn.textContent = 'Unregistering…';
      try {
        if ('serviceWorker' in navigator) {
          var regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(
            regs.map(function (r) {
              return r.unregister();
            })
          );
        }
        // Clearing sessionStorage lets coi-serviceworker's reload
        // counter reset, so the next load gets a fresh attempt budget.
        try {
          sessionStorage.removeItem('coi-serviceworker-attempts');
        } catch (_e) {
          /* sessionStorage may be blocked in private mode — fine */
        }
        btn.textContent = 'Reloading…';
        // Tiny delay so the label change paints before reload blanks the screen.
        setTimeout(function () {
          window.location.reload();
        }, 150);
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Retry';
        console.warn('[coi] unregister failed:', e);
      }
    });
  }

  function showCoiError() {
    // Disable the Launch buttons so the user can't fire an engine that
    // can't possibly boot.
    var launchBtn = document.getElementById('launchBtn');
    if (launchBtn) {
      launchBtn.disabled = true;
      launchBtn.title = 'Cross-origin isolation unavailable in this browser';
    }
    var cleanBtn = document.getElementById('cleanLaunchBtn');
    if (cleanBtn) {
      cleanBtn.disabled = true;
      cleanBtn.textContent = 'Cross-origin isolation failed';
    }
    var st = document.getElementById('status');
    if (st) st.textContent = '';

    // Inject a diagnostic card into the picker panel with recovery
    // instructions. Idempotent — if the card is already there, skip.
    var panel = document.querySelector('#boot .panel');
    if (!panel || document.getElementById('coi-error')) return;

    var cause = classifyCoiFailure();
    var body = buildErrorBody(cause);

    var div = document.createElement('div');
    div.id = 'coi-error';
    div.dataset.cause = cause;
    div.style.cssText =
      'padding:12px 14px;background:rgba(248,113,113,0.08);' +
      'border:1px solid rgba(248,113,113,0.45);border-radius:4px;' +
      'color:#f87171;font-size:11px;line-height:1.5;text-align:left;';
    div.innerHTML = body.html;

    if (body.showUnregisterBtn) {
      var btn = document.createElement('button');
      btn.id = 'coi-unregister-btn';
      btn.type = 'button';
      btn.textContent = 'Unregister service worker & reload';
      // Sized for fat-finger tapping on phones — min 44px tap target.
      btn.style.cssText =
        'display:block;margin-top:10px;width:100%;min-height:44px;' +
        'padding:10px 14px;background:#f87171;color:#1a0a0a;' +
        'border:none;border-radius:4px;font-size:13px;font-weight:600;' +
        'cursor:pointer;';
      div.appendChild(btn);
      wireUnregisterBtn(btn);
    }

    panel.insertBefore(div, panel.firstChild);
  }

  function poll() {
    if (_ready) return;
    if (window.crossOriginIsolated) {
      _ready = true;
      resolveAll();
      var st = document.getElementById('status');
      if (st && st.textContent && st.textContent.indexOf('isolation') >= 0) {
        st.textContent = '';
      }
      return;
    }
    if (elapsed() >= BUDGET_MS) {
      _failed = true;
      showCoiError();
      rejectAll(new Error('COI timeout'));
      if (window.LoDLifecycle) {
        window.LoDLifecycle.markError('coi', { budgetMs: BUDGET_MS });
      }
      return;
    }
    renderCountdown();
    setTimeout(poll, POLL_MS);
  }

  function whenReady() {
    if (_ready) return Promise.resolve();
    if (_failed) return Promise.reject(new Error('COI failed'));
    return new Promise(function (resolve, reject) {
      _waiters.push({ resolve: resolve, reject: reject });
    });
  }

  window.LoDCOI = {
    ready: function () {
      return _ready;
    },
    failed: function () {
      return _failed;
    },
    whenReady: whenReady,
    // Exposed for tests + for the hero-button subscriber that wants to
    // show a different label depending on why we failed.
    classifyFailure: classifyCoiFailure
  };

  if (!_ready) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', poll, { once: true });
    } else {
      poll();
    }
  }
})();
