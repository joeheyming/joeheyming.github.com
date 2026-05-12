// UZDoom — engine lifecycle.
//
// Single source of truth for "what phase is the page in?" Replaces the
// previous flag-soup (`state.launched`, `state.exited`, `state.ready`,
// `window.__COI_READY__`, `window.__UZDOOM_LOADER_READY__`,
// `Module.calledRun` checks in three places, and a MutationObserver
// watching `#boot.classList` for `hidden`).
//
// Phases:
//   loading    — scripts loading, COI not yet confirmed, picker empty.
//                Starting state.
//   primed     — an IWAD + (optional) mod list has been registered with
//                the loader; the engine is ready to receive Launch.
//                Entered from the picker, the clean-mode primeLoader,
//                or the `?iwad=…` URL path.
//   launching  — user (or auto-launcher) hit Launch; bootEngine is
//                running callMain. The canvas is visible but the engine
//                may not have drawn its first frame yet.
//   playing    — engine has handed control back after the melt/cut
//                reveal. The game is on screen.
//   exited     — engine terminated cleanly (Quit menu or ExitStatus).
//   error      — terminal failure. Detail carries { reason, … }:
//                  reason='coi'        — cross-origin isolation never
//                                        arrived.
//                  reason='wasm-abort' — Module.onAbort fired.
//                  reason='autoprime'  — primeLoader couldn't bind to
//                                        the picker (cold-load race
//                                        beyond the retry budget).
//                  reason='asset-fetch'— CORE_ASSETS download failed
//                                        hard (not per-asset — every
//                                        core asset failed).
//
// Write rules: every transition is called from exactly one place.
//   - coi.js             : loading → error{coi}
//   - uzdoom-loader.js   : loading → primed            (three sites:
//                                                        picker, URL
//                                                        auto-launch,
//                                                        freedoom btn)
//                        : primed → launching          (launchBtn click)
//                        : launching → playing         (post-melt reveal)
//                        : any → exited                (onEngineExit)
//                        : any → error{wasm-abort}     (Module.onAbort)
//   - index.html prime   : loading → error{autoprime}  (retry budget)
//
// Read rules: anyone can subscribe. Common subscribers:
//   - touch-input.js     : reveal overlay on `playing`, hide otherwise.
//   - index.html hero    : enable #cleanLaunchBtn on `primed`, disable
//                          on `launching`; swap label on `error`.
//   - uzdoom-loader.js   : guard re-entry in launchBtn click.
//   - instrumentation    : log every transition when ?bootlog=1.
//
// Terminal states (`exited`, `error`) swallow further transitions with
// a warning — fiddle with them and the "engine quit but the UI flashed
// a half-playing state" bugs come back.
//
// The lifecycle itself has zero dependencies — pure state, pure events.
// Load this file FIRST, before coi.js and any engine scripts, so every
// later subsystem finds a live singleton waiting.

var PHASES = ['loading', 'primed', 'launching', 'playing', 'exited', 'error'];
var TERMINAL = { exited: true, error: true };

var current = { phase: 'loading', detail: null };
var subscribers = [];
var history = []; // [{ phase, detail, t }]
var T0 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
var logEnabled = false;

try {
  var qs =
    typeof URLSearchParams !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  if (
    qs &&
    (qs.get('bootlog') === '1' || qs.get('coi-debug') === '1' || qs.get('phonelog') === '1')
  ) {
    logEnabled = true;
  }
} catch (e) {
  /* no-op */
}

function now() {
  return (
    (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - T0
  );
}

function record(from, to, detail) {
  var entry = { from: from, phase: to, detail: detail, t: now() };
  history.push(entry);
  if (logEnabled) {
    var msg = '[lifecycle] ' + (from || '<init>') + ' → ' + to;
    if (detail) {
      try {
        msg += ' ' + JSON.stringify(detail);
      } catch (_e) {
        msg += ' <unserializable detail>';
      }
    }
    msg += ' (+' + entry.t.toFixed(0) + 'ms)';
    console.log(msg);
  }
}

function set(phase, detail) {
  if (PHASES.indexOf(phase) === -1) {
    console.warn('[lifecycle] invalid phase:', phase);
    return false;
  }
  if (TERMINAL[current.phase]) {
    if (logEnabled) {
      console.warn('[lifecycle] ignored ' + current.phase + ' → ' + phase + ' (terminal)');
    }
    return false;
  }
  var from = current.phase;
  if (from === phase) return false;
  current = { phase: phase, detail: detail || null };
  record(from, phase, detail);
  var snap = subscribers.slice();
  for (var i = 0; i < snap.length; i++) {
    try {
      snap[i](current, from);
    } catch (e) {
      console.error('[lifecycle] subscriber threw:', e);
    }
  }
  return true;
}

function subscribe(fn) {
  if (typeof fn !== 'function') return function () {};
  subscribers.push(fn);
  try {
    fn(current, null);
  } catch (e) {
    console.error('[lifecycle] subscriber threw on init:', e);
  }
  return function unsubscribe() {
    var idx = subscribers.indexOf(fn);
    if (idx >= 0) subscribers.splice(idx, 1);
  };
}

export const UZDoomLifecycle = {
  PHASES: Object.freeze(PHASES.slice()),
  get: function () {
    return current.phase;
  },
  detail: function () {
    return current.detail;
  },
  history: function () {
    return history.slice();
  },
  isTerminal: function () {
    return !!TERMINAL[current.phase];
  },
  isRunning: function () {
    return current.phase === 'launching' || current.phase === 'playing';
  },

  markPrimed: function (desc) {
    return set('primed', desc || null);
  },
  markLaunching: function () {
    return set('launching', null);
  },
  markPlaying: function () {
    return set('playing', null);
  },
  markExited: function (code, reason) {
    return set('exited', { code: code, reason: reason || null });
  },
  markError: function (reason, detail) {
    return set('error', { reason: reason || 'unknown', detail: detail || null });
  },

  unprime: function () {
    if (current.phase === 'primed' || current.phase === 'launching') {
      return set('loading', null);
    }
    return false;
  },

  subscribe: subscribe,

  enableLog: function () {
    logEnabled = true;
  },
  disableLog: function () {
    logEnabled = false;
  }
};

window.UZDoomLifecycle = UZDoomLifecycle;

record(null, 'loading', null);
