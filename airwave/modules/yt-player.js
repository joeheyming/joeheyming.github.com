/**
 * Direct-postMessage YouTube IFrame controller.
 *
 * Why not `YT.Player`?
 *   This site has Cross-Origin-Embedder-Policy: require-corp on every
 *   response (set by `coi-serviceworker.js`, registered for the origin
 *   by the WASM/SharedArrayBuffer apps). YouTube's iframe doesn't send
 *   COEP headers, so a default-loaded `<iframe src="youtube.com/embed/...">`
 *   is blocked with "blocked:COEP-framed resource needs COEP header".
 *   The fix every other YouTube embed in this repo uses is the
 *   `credentialless` HTML attribute — but the official `YT.Player` API
 *   auto-creates the iframe internally and doesn't let callers add
 *   attributes to it.
 *
 *   So we build the iframe ourselves (with `credentialless`) and drive
 *   it via the IFrame API's documented postMessage protocol:
 *
 *     - Outbound: `{event:'command', func:'<name>', args:[...]}`
 *       sent to `iframe.contentWindow` with origin
 *       `https://www.youtube.com`.
 *     - Inbound: `{event:'onReady' | 'onStateChange' | 'onError' |
 *       'infoDelivery', info:...}` arriving on `window.message`.
 *       We register for these by sending `{event:'listening', id:...}`
 *       once the iframe loads.
 *
 *   This is the protocol the official API library wraps. By using it
 *   directly we skip the wrapper's quirks (missing methods race, no
 *   way to set iframe attributes) and solve the COEP issue at the
 *   same time.
 *
 * Audio-only: the iframe is positioned offscreen via the `.aw-player-host`
 * CSS so the user never sees video frames. The bytes still stream — no
 * client-side path to extract just the audio track from YouTube.
 */

const YT_ORIGIN = 'https://www.youtube.com';
const PLAYER_W = 200;
const PLAYER_H = 200;
const READY_TIMEOUT_MS = 15000;

function stateName(code) {
  switch (code) {
    case 0:
      return 'ended';
    case 1:
      return 'playing';
    case 2:
      return 'paused';
    case 3:
      return 'buffering';
    case 5:
      return 'cued';
    default:
      return 'unstarted';
  }
}

function buildEmbedSrc(videoId, { autoplay = false } = {}) {
  const params = new URLSearchParams({
    enablejsapi: '1',
    origin: typeof window !== 'undefined' ? window.location.origin : '',
    autoplay: autoplay ? '1' : '0',
    rel: '0',
    playsinline: '1',
    modestbranding: '1',
    iv_load_policy: '3',
    fs: '0'
  });
  return `${YT_ORIGIN}/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
}

export class AirwavePlayer {
  /**
   * @param {Object} opts
   * @param {string} opts.elementId — id of an empty placeholder element to be replaced.
   */
  constructor({ elementId }) {
    if (!elementId) throw new Error('AirwavePlayer requires an elementId');
    this.elementId = elementId;
    /** @type {HTMLIFrameElement | null} */
    this.iframe = null;
    /** @type {string | null} — the videoId currently loaded in the iframe. */
    this.currentVideoId = null;
    this.ready = false;

    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();

    /** @type {Promise<void> | null} */
    this._creating = null;
    /** @type {((e: MessageEvent) => void) | null} */
    this._messageListener = null;

    // Last-known transport state, kept fresh by `infoDelivery` messages.
    this._currentTime = 0;
    this._duration = 0;
    this._lastState = 'unstarted';
    // `infoDelivery.videoData.video_id` reports whatever video the
    // iframe is *currently playing* — that drifts to the ad's id
    // during pre/mid-roll ads, while `this.currentVideoId` stays on
    // the track we asked it to load. Comparing the two is the
    // cleanest "are we in an ad?" signal we get from the IFrame API.
    this._playingVideoId = null;
  }

  /**
   * Backwards-compat shim: `index.js` checks `player.player` truthiness
   * to know whether a player exists. The truthy thing here is the iframe.
   */
  get player() {
    return this.iframe;
  }

  /** No-op kept for boot-path compatibility — there's no external API to preload. */
  async preloadApi() {
    /* nothing to do */
  }

  /* ── Creation / lifecycle ──────────────────────────────────────── */

  /**
   * Lazy-create the iframe with `videoId` baked into the src. Subsequent
   * loads send `loadVideoById` / `cueVideoById` over postMessage instead
   * of recreating the iframe.
   *
   * @param {string} videoId
   * @param {{ autoplay?: boolean }} [opts]
   */
  async ensure(videoId, opts = {}) {
    if (this.iframe) return;
    if (this._creating) {
      await this._creating;
      return;
    }
    this._creating = this._createIframe(videoId, opts);
    try {
      await this._creating;
    } finally {
      this._creating = null;
    }
  }

  _createIframe(videoId, { autoplay = false } = {}) {
    return new Promise((resolve, reject) => {
      const host = document.getElementById(this.elementId);
      if (!host) {
        reject(new Error(`AirwavePlayer: host element #${this.elementId} not found`));
        return;
      }

      const iframe = document.createElement('iframe');
      iframe.id = this.elementId;
      iframe.title = 'Airwave audio player';
      iframe.src = buildEmbedSrc(videoId, { autoplay });
      // The whole point: COEP-isolated pages can still embed YouTube
      // when the iframe is `credentialless`.
      iframe.setAttribute('credentialless', '');
      iframe.setAttribute(
        'allow',
        'autoplay; encrypted-media; picture-in-picture; clipboard-write'
      );
      iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      iframe.style.cssText = `width:${PLAYER_W}px;height:${PLAYER_H}px;border:0;`;

      host.parentNode.replaceChild(iframe, host);
      this.iframe = iframe;
      this.currentVideoId = videoId;

      this._messageListener = (e) => this._handleMessage(e);
      window.addEventListener('message', this._messageListener);

      // Once the iframe loads, subscribe to events. Without this
      // handshake the iframe never sends `onReady` over postMessage.
      iframe.addEventListener(
        'load',
        () => {
          this._postCommand('listening', null, { event: 'listening', id: this.elementId });
        },
        { once: true }
      );

      let settled = false;
      const onReady = () => {
        if (settled) return;
        settled = true;
        this.ready = true;
        this.off('ready', onReady);
        clearTimeout(timeoutId);
        resolve();
      };
      this.on('ready', onReady);

      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.off('ready', onReady);
        reject(
          new Error(
            'YouTube iframe never reported ready. The video may be blocked or the page may be offline.'
          )
        );
      }, READY_TIMEOUT_MS);
    });
  }

  /** @param {MessageEvent} event */
  _handleMessage(event) {
    if (!this.iframe) return;
    if (event.source !== this.iframe.contentWindow) return;
    if (event.origin !== YT_ORIGIN && event.origin !== 'https://www.youtube-nocookie.com') return;

    let data = event.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    if (!data || typeof data !== 'object') return;

    switch (data.event) {
      case 'onReady':
      case 'initialDelivery':
        // YouTube sometimes sends `initialDelivery` instead of `onReady`
        // depending on browser timing; both mean the iframe is alive.
        this._emit('ready', data);
        break;
      case 'onStateChange': {
        const name = stateName(data.info);
        this._lastState = name;
        this._emit(name, data);
        break;
      }
      case 'onError':
        this._emit('error', { data: data.info });
        break;
      case 'infoDelivery':
        if (data.info && typeof data.info === 'object') {
          if (typeof data.info.currentTime === 'number') {
            this._currentTime = data.info.currentTime;
          }
          if (typeof data.info.duration === 'number') {
            this._duration = data.info.duration;
          }
          if (data.info.videoData && typeof data.info.videoData.video_id === 'string') {
            this._playingVideoId = data.info.videoData.video_id;
          }
          if (typeof data.info.playerState === 'number') {
            const name = stateName(data.info.playerState);
            if (name !== this._lastState) {
              this._lastState = name;
              this._emit(name, data);
            }
          }
        }
        break;
      default:
        /* unknown event; ignore */
        break;
    }
  }

  /* ── Event bus ─────────────────────────────────────────────────── */

  on(event, handler) {
    if (typeof handler !== 'function') return () => {};
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    const set = this.listeners.get(event);
    if (set) set.delete(handler);
  }

  _emit(event, payload) {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch (err) {
        console.error('[airwave] listener for', event, 'threw:', err);
      }
    }
  }

  /* ── postMessage commands ──────────────────────────────────────── */

  _postCommand(func, args, raw) {
    if (!this.iframe || !this.iframe.contentWindow) return;
    const payload = raw
      ? raw
      : {
          event: 'command',
          func,
          args: Array.isArray(args) ? args : args == null ? [] : [args]
        };
    try {
      this.iframe.contentWindow.postMessage(JSON.stringify(payload), YT_ORIGIN);
    } catch (err) {
      console.warn('[airwave] postMessage to YouTube iframe failed:', err);
    }
  }

  /* ── Playback ──────────────────────────────────────────────────── */

  /** Load and play a video. First call lazily creates the iframe. */
  async loadVideo(videoId, { startSeconds = 0 } = {}) {
    if (!this.iframe) {
      await this.ensure(videoId, { autoplay: true });
      if (Number(startSeconds) > 0) {
        this.seekTo(Number(startSeconds), true);
      }
      return;
    }
    this.currentVideoId = videoId;
    this._playingVideoId = null;
    this._postCommand('loadVideoById', [{ videoId, startSeconds }]);
  }

  /** Cue (don't play) a video. First call lazily creates the iframe. */
  async cueVideo(videoId, { startSeconds = 0 } = {}) {
    if (!this.iframe) {
      await this.ensure(videoId, { autoplay: false });
      return;
    }
    this.currentVideoId = videoId;
    this._playingVideoId = null;
    this._postCommand('cueVideoById', [{ videoId, startSeconds }]);
  }

  loadPlaylist(listId, { index = 0 } = {}) {
    if (!this.iframe || !listId) return;
    // YouTube drives next-track inside a playlist URL, so we lose
    // track of which video is "current". Null it out — the ad
    // detector keys off this and shouldn't false-fire here.
    this.currentVideoId = null;
    this._playingVideoId = null;
    this._postCommand('loadPlaylist', [{ list: listId, listType: 'playlist', index }]);
  }

  play() {
    this._postCommand('playVideo');
  }
  pause() {
    this._postCommand('pauseVideo');
  }
  stop() {
    this._postCommand('stopVideo');
  }

  seekTo(seconds, allowSeekAhead = true) {
    this._postCommand('seekTo', [Number(seconds) || 0, Boolean(allowSeekAhead)]);
  }

  /** Adjust by a relative offset, clamped to [0, duration]. */
  nudge(deltaSeconds) {
    const t = this._currentTime;
    const d = this._duration || 0;
    const next = Math.max(0, Math.min(d || t + deltaSeconds, t + deltaSeconds));
    this.seekTo(next, true);
  }

  setPlaybackRate(rate) {
    this._postCommand('setPlaybackRate', [Number(rate) || 1]);
  }
  setVolume(volume0to100) {
    const v = Math.max(0, Math.min(100, Math.round(Number(volume0to100) || 0)));
    this._postCommand('setVolume', [v]);
    this._postCommand(v === 0 ? 'mute' : 'unMute');
  }

  /* Read-only state. Source of truth is the steady stream of
   * `infoDelivery` messages from the iframe — much steadier than
   * synchronously calling `getCurrentTime()` on a wrapper. */
  getCurrentTime() {
    return this._currentTime;
  }
  getDuration() {
    return this._duration;
  }
  getStateName() {
    return this._lastState;
  }
  /** What the iframe is *actually* playing right now. Differs from
   * `currentVideoId` when YouTube is showing a pre/mid-roll ad. */
  getPlayingVideoId() {
    return this._playingVideoId;
  }

  /* ── Teardown ─────────────────────────────────────────────────── */

  _destroyPlayer() {
    if (this._messageListener) {
      window.removeEventListener('message', this._messageListener);
      this._messageListener = null;
    }
    if (this.iframe && this.iframe.parentNode) {
      const fresh = document.createElement('div');
      fresh.id = this.elementId;
      this.iframe.parentNode.replaceChild(fresh, this.iframe);
    }
    this.iframe = null;
    this.currentVideoId = null;
    this.ready = false;
    this._creating = null;
    this._currentTime = 0;
    this._duration = 0;
    this._lastState = 'unstarted';
    this._playingVideoId = null;
  }
}

export const _internals = { stateName, buildEmbedSrc, PLAYER_W, PLAYER_H };
