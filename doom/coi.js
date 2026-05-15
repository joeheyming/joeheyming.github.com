// UZDoom — cross-origin isolation (COI) subsystem.
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
// (`UZDoomCOI.whenReady()`) that every caller can await. On failure we
// transition the lifecycle to `error{coi}` so subscribers (the hero
// button, touch overlay) can react in a single place.
//
// Depends on: lifecycle.js (optional — degrades gracefully if missing).

import { UZDoomLifecycle } from './lifecycle.js';

var BUDGET_MS = 8000;
var POLL_MS = 500;
var T0 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

var _ready = !!window.crossOriginIsolated;
var _failed = false;
var _waiters = [];

function elapsed() {
  var now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
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

function effectiveBudget() {
  return BUDGET_MS;
}

function renderCountdown() {
  var st = document.getElementById('status');
  if (!st) return;
  var remaining = Math.max(0, Math.ceil((effectiveBudget() - elapsed()) / 1000));
  st.textContent = 'Preparing the game (' + remaining + 's)…';
}

function detectInAppBrowser() {
  var ua = (navigator.userAgent || '') + ' ' + (navigator.vendor || '');
  if (/\bFBAN\b|\bFBAV\b|\bFB_IAB\b|\bFBDV\b|\bFBSN\b/i.test(ua)) return 'facebook';
  if (/Instagram/i.test(ua)) return 'instagram';
  if (/\bBytedanceWebview\b|musical_ly|\bTTWebView\b|\bBytedanceIJK\b/i.test(ua)) return 'tiktok';
  if (/Twitter for (iPhone|iPad|Android)/i.test(ua)) return 'twitter';
  if (/\bLinkedInApp\b/i.test(ua)) return 'linkedin';
  if (/\bSnapchat\b/i.test(ua)) return 'snapchat';
  if (/\bLine\//i.test(ua)) return 'line';
  var isIOS = /iPhone|iPad|iPod/i.test(ua);
  if (isIOS && /AppleWebKit/i.test(ua) && !/Safari/i.test(ua) && !/CriOS|FxiOS/i.test(ua)) {
    return 'ios-webview';
  }
  return null;
}

function classifyCoiFailure() {
  var inApp = detectInAppBrowser();
  if (inApp) return 'in-app';
  if (window.isSecureContext === false) return 'insecure';
  if (!('serviceWorker' in navigator)) return 'no-sw';
  return 'sw-stuck';
}

function buildErrorBody(cause) {
  if (cause === 'in-app') {
    return {
      showUnregisterBtn: false,
      showOpenExternalBtn: true,
      html:
        "<strong>This app's built-in browser can't run the game.</strong>" +
        '<br /><br />Tap <b>⋯</b> (or <b>⋮</b>) and pick <b>Open in Browser</b>, ' +
        'or use the button below.'
    };
  }
  if (cause === 'insecure') {
    return {
      showUnregisterBtn: false,
      showOpenExternalBtn: false,
      html:
        '<strong>HTTPS required.</strong>' +
        "<br /><br />This page isn't on a secure origin, so the engine " +
        "can't load. Open the HTTPS version of the link, or install " +
        '<a href="https://zdoom.org/downloads" target="_blank" rel="noopener" ' +
        'style="color:#f87171">GZDoom</a> and run the mod natively.'
    };
  }
  if (cause === 'no-sw') {
    return {
      showUnregisterBtn: false,
      showOpenExternalBtn: false,
      html:
        "<strong>This browser doesn't support the game.</strong>" +
        '<br /><br />Try a regular tab in Chrome, Firefox, or Safari — or ' +
        'install <a href="https://zdoom.org/downloads" target="_blank" ' +
        'rel="noopener" style="color:#f87171">GZDoom</a> to play natively.'
    };
  }
  return {
    showUnregisterBtn: true,
    showOpenExternalBtn: false,
    html:
      "<strong>Couldn't start the game.</strong>" +
      '<br /><br />Something from a previous visit is stuck. Tap below to ' +
      "reset and reload. If that doesn't help, install " +
      '<a href="https://zdoom.org/downloads" target="_blank" rel="noopener" ' +
      'style="color:#f87171">GZDoom</a> locally.'
  };
}

function wireOpenExternalBtn(btn) {
  btn.addEventListener('click', function () {
    var url = window.location.href;
    var ua = navigator.userAgent || '';
    var isIOS = /iPhone|iPad|iPod/i.test(ua);
    var isAndroid = /Android/i.test(ua);
    try {
      if (isIOS) {
        var httpsUrl = url.replace(/^https?:\/\//, '');
        var safariUrl = 'x-safari-https://' + httpsUrl;
        window.location.href = safariUrl;
        setTimeout(function () {
          window.open(url, '_blank');
        }, 400);
      } else if (isAndroid) {
        var intentUrl =
          'intent://' +
          url.replace(/^https?:\/\//, '') +
          '#Intent;scheme=https;action=android.intent.action.VIEW;' +
          'category=android.intent.category.BROWSABLE;end';
        window.location.href = intentUrl;
        setTimeout(function () {
          window.open(url, '_blank');
        }, 400);
      } else {
        window.open(url, '_blank');
      }
    } catch (_e) {
      try {
        navigator.clipboard.writeText(url);
        btn.textContent = 'URL copied — paste into Chrome/Safari';
      } catch (_e2) {
        btn.textContent = "Couldn't open — long-press the address bar to copy";
      }
    }
  });
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
      try {
        sessionStorage.removeItem('coi-serviceworker-attempts');
      } catch (_e) {
        /* sessionStorage may be blocked in private mode — fine */
      }
      btn.textContent = 'Reloading…';
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
  var launchBtn = document.getElementById('launchBtn');
  if (launchBtn) {
    launchBtn.disabled = true;
    launchBtn.title = "This browser can't run the game";
  }
  var cleanBtn = document.getElementById('cleanLaunchBtn');
  if (cleanBtn) {
    cleanBtn.disabled = true;
    cleanBtn.textContent = "Couldn't start the game";
  }
  var st = document.getElementById('status');
  if (st) st.textContent = '';

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
    btn.textContent = 'Reset and reload';
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
  var budget = effectiveBudget();
  if (elapsed() >= budget) {
    _failed = true;
    showCoiError();
    rejectAll(new Error('COI timeout'));
    UZDoomLifecycle.markError('coi', { budgetMs: budget });
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

export const UZDoomCOI = {
  ready: function () {
    return _ready;
  },
  failed: function () {
    return _failed;
  },
  whenReady: whenReady,
  classifyFailure: classifyCoiFailure
};

window.UZDoomCOI = UZDoomCOI;

if (!_ready) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', poll, { once: true });
  } else {
    poll();
  }
}
