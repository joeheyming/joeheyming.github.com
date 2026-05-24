/**
 * Background-survival hack for the Trip Log app.
 *
 * Chrome on Android aggressively suspends background tabs: locking the
 * screen makes the page hidden, the Wake Lock auto-releases, `setInterval`
 * gets throttled, and after roughly five minutes the page is "frozen"
 * outright — `watchPosition` callbacks stop firing along with everything
 * else. That's the documented behaviour from
 * https://developer.chrome.com/blog/freezing-on-energy-saver and
 * https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/performance_manager/docs/freezing_opt_out_opt_in.md
 *
 * Both docs explicitly list "playing audio" as an opt-out from freezing,
 * along with title updates and persistent notifications. So while the
 * recorder is running we:
 *
 *  1. Spin up a Web Audio graph that emits low-amplitude (~ -46 dBFS)
 *     white noise on a one-second loop. Real audio frames hit the
 *     output device → Chrome's "is this tab audible" RMS check passes
 *     → tab is exempt from background freezing. We previously ran at
 *     ~-74 dBFS which was below Chrome's audibility threshold, so
 *     the tab was being frozen anyway; -46 dBFS is the sweet spot
 *     between "definitely counted as audio" and "user can't hear it".
 *  2. Register `navigator.mediaSession` with metadata + play/pause
 *     handlers, so Android puts a "Trip Log — recording" entry on the
 *     lock screen. Media-session pages get further lifecycle priority
 *     and the user gets pause/resume controls without unlocking.
 *  3. Tick the document title with live distance/duration. Title
 *     mutations are another freeze-exemption signal, and they make
 *     the recents card preview show "0.4 mi · 8:12" while the user
 *     has the tab in the background.
 *  4. Drive a persistent system notification through the service
 *     worker. A notification with `requireInteraction: true` keeps
 *     the page at "foreground service" importance on Android, which
 *     dramatically reduces the chance the OS will throttle GPS even
 *     once the screen locks. Only meaningful when the user has
 *     installed the PWA *and* granted notification permission, so
 *     the install-prompt makes this a real lever.
 *
 * Nothing here guarantees that GPS itself keeps firing while the
 * screen is locked — Android can throttle the GPS subsystem
 * independently of page lifecycle — but this is the strongest known
 * combination of levers a static web page (and an installed PWA) has.
 * The gap-aware logic in `triplog-tracker.js` covers the remaining
 * failure case where fixes still drop out.
 *
 * Public surface is `createKeepalive()` returning:
 *   - `start({ onPause, onResume })`   begin keep-alive
 *   - `update({ paused, title })`      refresh metadata + title ticker
 *   - `stop()`                         tear it all down
 *
 * The factory is safe to call before `start`/after `stop` — every
 * method is idempotent and tolerates missing browser APIs.
 */

/**
 * Sample amplitude for the silent loop. ~ -46 dBFS — high enough
 * for Chrome's audible-tab detector to fire, but low enough to be
 * inaudible in a pocket or on a desk at normal volumes. The previous
 * value (0.0002, ~ -74 dBFS) was below Chrome's threshold, which is
 * why the keepalive didn't actually prevent suspension.
 */
const SILENT_NOISE_AMPLITUDE = 0.005;

/**
 * @typedef {object} KeepaliveCallbacks
 * @property {() => void} [onPause]   fired when the user taps "pause" on the lock-screen media controls
 * @property {() => void} [onResume]  fired when the user taps "play" on the lock-screen media controls
 */

/**
 * @typedef {object} KeepaliveUpdate
 * @property {boolean} [paused]    flips MediaSession playback state ('paused' vs 'playing')
 * @property {string}  [title]     short status line for the document title (e.g. "0.4 mi · 8:12")
 * @property {string}  [subtitle]  shown as the MediaSession "artist" line on the lock screen
 */

export function createKeepalive() {
  /** @type {AudioContext | null} */
  let audioCtx = null;
  /** @type {AudioBufferSourceNode | null} */
  let audioSource = null;
  /** @type {string | null} */
  let originalTitle = null;
  /** @type {KeepaliveCallbacks} */
  let callbacks = {};
  let active = false;
  let lastVisibilityHandler = /** @type {(() => void) | null} */ (null);
  /**
   * Last delivered notification payload (so visibility-driven
   * re-pings can refresh the SW notification without the caller
   * having to remember what was last shown).
   * @type {{ title: string, subtitle: string, paused: boolean } | null}
   */
  let lastNotificationPayload = null;

  function startSilentLoop() {
    /** @type {typeof AudioContext | undefined} */
    const Ctor =
      // @ts-expect-error - webkitAudioContext typings live in lib.dom.iterable
      typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : undefined;
    if (!Ctor) {
      return;
    }
    try {
      const ctx = new Ctor();
      // Build a one-second mono buffer of very-low-amplitude noise.
      // Noise (vs. a fixed DC offset or a sine) ensures Chrome can't
      // shortcut us as "silent buffer, optimise out" — every frame has
      // a different value, and the integrated RMS is non-zero.
      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() - 0.5) * SILENT_NOISE_AMPLITUDE;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.connect(ctx.destination);
      src.start();
      audioCtx = ctx;
      audioSource = src;

      // Some browsers suspend the AudioContext when the tab becomes
      // hidden. We need it kept alive to count as "playing audio" for
      // the freeze-exemption — re-resume on every visibility flip.
      const handler = () => {
        if (audioCtx && audioCtx.state === 'suspended') {
          void audioCtx.resume().catch(() => {
            /* user gesture lost — nothing we can do */
          });
        }
      };
      document.addEventListener('visibilitychange', handler);
      lastVisibilityHandler = handler;
    } catch (e) {
      console.warn('[triplog] keepalive audio failed', e);
    }
  }

  function stopSilentLoop() {
    if (lastVisibilityHandler) {
      document.removeEventListener('visibilitychange', lastVisibilityHandler);
      lastVisibilityHandler = null;
    }
    try {
      audioSource?.stop();
    } catch {
      /* already stopped */
    }
    try {
      audioSource?.disconnect();
    } catch {
      /* already disconnected */
    }
    audioSource = null;
    if (audioCtx) {
      // Closing releases the audio output device. We don't `await` it
      // because callers don't need to block on cleanup.
      void audioCtx.close().catch(() => {});
      audioCtx = null;
    }
  }

  function setMediaSession({ paused = false, subtitle = 'Recording' } = {}) {
    if (!('mediaSession' in navigator)) {
      return;
    }
    try {
      // Browsers that have MediaSession but not MediaMetadata are rare
      // (it's been a unit since ~2017) but the constructor existence
      // check costs nothing.
      const Meta = /** @type {any} */ (window).MediaMetadata;
      if (Meta) {
        navigator.mediaSession.metadata = new Meta({
          title: 'Trip Log',
          artist: subtitle,
          album: ''
        });
      }
      navigator.mediaSession.playbackState = paused ? 'paused' : 'playing';
      // Wire the lock-screen pause/play affordances to our recorder.
      // We re-set these on every update because some browsers clear
      // them when the tab loses focus.
      navigator.mediaSession.setActionHandler('pause', () => {
        callbacks.onPause?.();
      });
      navigator.mediaSession.setActionHandler('play', () => {
        callbacks.onResume?.();
      });
    } catch (e) {
      console.warn('[triplog] mediaSession update failed', e);
    }
  }

  function clearMediaSession() {
    if (!('mediaSession' in navigator)) {
      return;
    }
    try {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('play', null);
    } catch {
      /* nothing important here — best-effort cleanup */
    }
  }

  /**
   * Push the current status to the service worker so it can keep the
   * persistent recording notification in sync. Cheap; falls through
   * silently if the SW isn't installed, isn't controlling the page,
   * or the user hasn't granted notification permission.
   *
   * @param {{ title: string, subtitle: string, paused: boolean }} payload
   */
  function postRecordingStatusToSw(payload) {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
      return;
    }
    const ctrl = navigator.serviceWorker.controller;
    if (!ctrl) {
      // SW is registered but hasn't taken control of this page yet
      // (happens on the very first load before reload). No-op; the
      // next status update after the page comes back will catch up.
      return;
    }
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      return;
    }
    try {
      ctrl.postMessage({
        type: 'recording-status',
        title: payload.paused ? 'Trip Log — paused' : 'Trip Log — recording',
        body: payload.title,
        paused: payload.paused
      });
    } catch (err) {
      console.warn('[triplog] postRecordingStatusToSw failed', err);
    }
  }

  function clearRecordingNotification() {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
      return;
    }
    const ctrl = navigator.serviceWorker.controller;
    if (!ctrl) {
      return;
    }
    try {
      ctrl.postMessage({ type: 'stop-recording' });
    } catch {
      /* best-effort cleanup */
    }
  }

  return {
    /** @returns {boolean} */
    get isActive() {
      return active;
    },

    /**
     * Start keep-alive. Must be called from a user gesture (the Start
     * button) so the AudioContext is allowed to play.
     *
     * @param {KeepaliveCallbacks} [cb]
     */
    start(cb = {}) {
      if (active) {
        return;
      }
      active = true;
      callbacks = cb;
      originalTitle = document.title;
      startSilentLoop();
      setMediaSession({ paused: false, subtitle: 'Recording' });
    },

    /**
     * Refresh the document title and MediaSession metadata. Cheap to
     * call frequently (no DOM diffing concerns at this scale) — wire
     * it to the live stats stream.
     *
     * @param {KeepaliveUpdate} [u]
     */
    update(u = {}) {
      if (!active) {
        return;
      }
      const { paused = false, title, subtitle } = u;
      if (typeof title === 'string' && title.length > 0) {
        const prefix = paused ? '⏸ ' : '⏺ ';
        document.title = `${prefix}${title} — Trip Log`;
      }
      const computedSubtitle = subtitle || (paused ? 'Paused' : 'Recording');
      setMediaSession({ paused, subtitle: computedSubtitle });
      if (typeof title === 'string' && title.length > 0) {
        lastNotificationPayload = { title, subtitle: computedSubtitle, paused };
        postRecordingStatusToSw(lastNotificationPayload);
      }
    },

    /** Tear everything down — restores title, releases audio, clears MediaSession. */
    stop() {
      if (!active) {
        return;
      }
      active = false;
      callbacks = {};
      lastNotificationPayload = null;
      stopSilentLoop();
      clearMediaSession();
      clearRecordingNotification();
      if (originalTitle !== null) {
        document.title = originalTitle;
        originalTitle = null;
      }
    }
  };
}
