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
 *  1. Spin up a Web Audio graph that emits near-silent (~ -74 dBFS)
 *     white noise on a one-second loop. Real audio frames hit the
 *     output device → Chrome marks the tab "audible" → tab is exempt
 *     from background freezing. The amplitude is low enough that the
 *     user can't hear it even at full system volume.
 *  2. Register `navigator.mediaSession` with metadata + play/pause
 *     handlers, so Android puts a "Trip Log — recording" entry on the
 *     lock screen. Media-session pages get further lifecycle priority
 *     and the user gets pause/resume controls without unlocking.
 *  3. Tick the document title with live distance/duration. Title
 *     mutations are another freeze-exemption signal, and they make
 *     the recents card preview show "0.4 mi · 8:12" while the user
 *     has the tab in the background.
 *
 * Nothing here guarantees that GPS itself keeps firing while the
 * screen is locked — Android can throttle the GPS subsystem
 * independently of page lifecycle — but this is the strongest known
 * lever a static web page has. The gap-aware logic in
 * `triplog-tracker.js` covers the remaining failure case where fixes
 * still drop out.
 *
 * Public surface is `createKeepalive()` returning:
 *   - `start({ onPause, onResume })`   begin keep-alive
 *   - `update({ paused, title })`      refresh metadata + title ticker
 *   - `stop()`                         tear it all down
 *
 * The factory is safe to call before `start`/after `stop` — every
 * method is idempotent and tolerates missing browser APIs.
 */

/** Sample amplitude for the silent loop. ~ -74 dBFS — well below audibility. */
const SILENT_NOISE_AMPLITUDE = 0.0002;

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
      setMediaSession({
        paused,
        subtitle: subtitle || (paused ? 'Paused' : 'Recording')
      });
    },

    /** Tear everything down — restores title, releases audio, clears MediaSession. */
    stop() {
      if (!active) {
        return;
      }
      active = false;
      callbacks = {};
      stopSilentLoop();
      clearMediaSession();
      if (originalTitle !== null) {
        document.title = originalTitle;
        originalTitle = null;
      }
    }
  };
}
