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
// Legal edges. A missing edge returns false: the phase and the history
// stay put, and subscribers are not called. markError and markExited are
// legal from every non-terminal phase, because the engine-exit handler
// is installed while the page is still loading, a callMain throw happens
// during launching, and a later quit happens during playing.
//
//   loading   → primed      markPrimed      picker, Freedoom, primeWith
//   loading   → error       markError       coi, autoprime, flavor-prime,
//                                            wasm-abort
//   loading   → exited      markExited      onEngineExit before launch
//   primed    → launching   markLaunching   launchEngine, only from primed
//   primed    → loading     unprime
//   primed    → error       markError
//   primed    → exited      markExited
//   launching → playing     markPlaying     post-melt reveal
//   launching → loading     unprime         file prep failed
//   launching → error       markError
//   launching → exited      markExited
//   playing   → error       markError
//   playing   → exited      markExited
//
// `exited` and `error` accept nothing further. Refusing those, and
// refusing a jump such as playing → primed, is what keeps a quit from
// flashing a half-playing UI. With ?bootlog=1 a refusal names the
// from-phase, the event, and `terminal` or `illegal`.
//
// Read rules: anyone can subscribe. Common subscribers:
//   - touch-input.js     : reveal overlay on `playing`, hide otherwise.
//   - index.html hero    : enable #cleanLaunchBtn on `primed`, disable
//                          on `launching`; swap label on `error`.
//   - uzdoom-loader.js   : guard re-entry in launchBtn click.
//   - instrumentation    : log every transition when ?bootlog=1.
//
// The lifecycle itself has zero dependencies — pure state, pure events.
// Load this file FIRST, before coi.js and any engine scripts, so every
// later subsystem finds a live singleton waiting.

var PHASES = ['loading', 'primed', 'launching', 'playing', 'exited', 'error'];
var TERMINAL = { exited: true, error: true };

// Next phase for each event. Absent means the event is refused.
var EDGES = {
  loading: { markPrimed: 'primed', markError: 'error', markExited: 'exited' },
  primed: {
    markLaunching: 'launching',
    unprime: 'loading',
    markError: 'error',
    markExited: 'exited'
  },
  launching: {
    markPlaying: 'playing',
    unprime: 'loading',
    markError: 'error',
    markExited: 'exited'
  },
  playing: { markError: 'error', markExited: 'exited' },
  exited: {},
  error: {}
};

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

function apply(event, detail) {
  var from = current.phase;
  var row = EDGES[from];
  var to = row && row[event];
  if (!to || PHASES.indexOf(to) === -1) {
    if (logEnabled) {
      var why = TERMINAL[from] ? 'terminal' : 'illegal';
      console.warn('[lifecycle] ignored ' + from + ' ' + event + ' (' + why + ')');
    }
    return false;
  }
  current = { phase: to, detail: detail || null };
  record(from, to, detail);
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
    return apply('markPrimed', desc || null);
  },
  markLaunching: function () {
    return apply('markLaunching', null);
  },
  markPlaying: function () {
    return apply('markPlaying', null);
  },
  markExited: function (code, reason) {
    return apply('markExited', { code: code, reason: reason || null });
  },
  markError: function (reason, detail) {
    return apply('markError', { reason: reason || 'unknown', detail: detail || null });
  },

  unprime: function () {
    return apply('unprime', null);
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
