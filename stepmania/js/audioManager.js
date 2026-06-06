// AudioManager - Singleton for managing audio playback
// Centralizes audio element access, blob URL lifecycle, and event handling

import gameState from './gameState.js';

/**
 * Hard cap on playbackRate. Browsers technically accept up to 16, but the
 * built-in time-stretching algorithm artifacts badly past ~2× when
 * preservesPitch is on, and past ~3× even without it. We expose 0.5×–2.0×
 * with pitch preservation (and 0.5×–3.0× without, see setPlaybackRate).
 */
const RATE_MIN = 0.5;
const RATE_MAX_PITCH_PRESERVED = 2.0;
const RATE_MAX_PITCH_FREE = 3.0;

class AudioManager {
  constructor() {
    if (AudioManager.instance) {
      return AudioManager.instance;
    }
    AudioManager.instance = this;

    /** @type {HTMLAudioElement|null} */
    this.element = null;

    /** Track current blob URL for cleanup */
    this._currentBlobUrl = null;

    /**
     * Cached playback rate so we can re-apply it after the audio element
     * gets a new source (`<source>` swap resets playbackRate on some
     * browsers). Single source of truth: the JS value, not the DOM.
     */
    this._playbackRate = 1.0;

    /**
     * Whether to preserve pitch when changing playbackRate. Stored alongside
     * the rate because both have to be re-applied together after a load.
     */
    this._preservePitch = true;

    /** Event listeners storage for cleanup */
    this._listeners = {
      play: [],
      pause: [],
      seeked: [],
      ended: [],
      canplay: [],
      error: [],
      timeupdate: []
    };

    /** Bound internal handlers */
    this._boundHandlers = {
      onPlay: this._onPlay.bind(this),
      onPause: this._onPause.bind(this),
      onSeeked: this._onSeeked.bind(this),
      onEnded: this._onEnded.bind(this),
      onCanPlay: this._onCanPlay.bind(this),
      onError: this._onError.bind(this),
      onTimeUpdate: this._onTimeUpdate.bind(this)
    };

    this._elementListenersAttached = false;
  }

  /**
   * Initialize the audio manager (gets DOM element internally)
   * @param {HTMLAudioElement} [element] - Optional audio element (defaults to #audio_with_controls)
   */
  init(element = null) {
    if (this.element) {
      this._detachElementListeners();
    }

    this.element = element || document.getElementById('audio_with_controls');

    if (!this.element) {
      console.warn('AudioManager: Audio element not found');
      return;
    }

    this._attachElementListeners();
    // Apply any rate/pitch state that was set before init() ran (e.g. when
    // a future userPrefs module restores prefs at boot).
    this.setPlaybackRate(this._playbackRate, this._preservePitch);
  }

  /**
   * Attach listeners to the audio element
   */
  _attachElementListeners() {
    if (this._elementListenersAttached || !this.element) return;

    this.element.addEventListener('play', this._boundHandlers.onPlay);
    this.element.addEventListener('pause', this._boundHandlers.onPause);
    this.element.addEventListener('seeked', this._boundHandlers.onSeeked);
    this.element.addEventListener('ended', this._boundHandlers.onEnded);
    this.element.addEventListener('canplay', this._boundHandlers.onCanPlay);
    this.element.addEventListener('error', this._boundHandlers.onError);
    this.element.addEventListener('timeupdate', this._boundHandlers.onTimeUpdate);

    this._elementListenersAttached = true;
  }

  /**
   * Detach listeners from the audio element
   */
  _detachElementListeners() {
    if (!this._elementListenersAttached || !this.element) return;

    this.element.removeEventListener('play', this._boundHandlers.onPlay);
    this.element.removeEventListener('pause', this._boundHandlers.onPause);
    this.element.removeEventListener('seeked', this._boundHandlers.onSeeked);
    this.element.removeEventListener('ended', this._boundHandlers.onEnded);
    this.element.removeEventListener('canplay', this._boundHandlers.onCanPlay);
    this.element.removeEventListener('error', this._boundHandlers.onError);
    this.element.removeEventListener('timeupdate', this._boundHandlers.onTimeUpdate);

    this._elementListenersAttached = false;
  }

  // ===========================================================================
  // INTERNAL EVENT HANDLERS
  // ===========================================================================

  _onPlay() {
    this._notifyListeners('play');
  }

  _onPause() {
    this._notifyListeners('pause');
  }

  _onSeeked() {
    this._notifyListeners('seeked');
  }

  _onEnded() {
    this._notifyListeners('ended');
  }

  _onCanPlay() {
    this._notifyListeners('canplay');
  }

  _onError(event) {
    this._notifyListeners('error', event);
  }

  _onTimeUpdate() {
    this._notifyListeners('timeupdate');
  }

  /**
   * Notify all listeners for an event type
   * @param {string} eventType - Event type
   * @param {*} [data] - Optional event data
   */
  _notifyListeners(eventType, data = null) {
    const listeners = this._listeners[eventType] || [];
    listeners.forEach((callback) => {
      try {
        callback(data);
      } catch (e) {
        console.error(`Error in AudioManager ${eventType} listener:`, e);
      }
    });
  }

  // ===========================================================================
  // STATE GETTERS
  // ===========================================================================

  /**
   * Get current playback time
   * @returns {number}
   */
  get currentTime() {
    return this.element?.currentTime || 0;
  }

  /**
   * Set current playback time
   * @param {number} time
   */
  set currentTime(time) {
    if (this.element) {
      this.element.currentTime = time;
    }
  }

  /**
   * Check if audio is paused
   * @returns {boolean}
   */
  get paused() {
    return this.element?.paused ?? true;
  }

  /**
   * Get audio duration
   * @returns {number}
   */
  get duration() {
    return this.element?.duration || 0;
  }

  /**
   * Get current time with music offset applied (for game timing)
   * @returns {number}
   */
  get currentTimeWithOffset() {
    const offset = gameState.getMusicOffset();
    return this.currentTime + offset;
  }

  // ===========================================================================
  // PLAYBACK CONTROL
  // ===========================================================================

  /**
   * Start playback
   * @returns {Promise<void>}
   */
  play() {
    if (!this.element) return Promise.reject(new Error('Audio not initialized'));
    return this.element.play();
  }

  /**
   * Pause playback
   */
  pause() {
    if (this.element) {
      this.element.pause();
    }
  }

  /**
   * Toggle play/pause
   */
  toggle() {
    if (this.paused) {
      this.play().catch(() => {});
    } else {
      this.pause();
    }
  }

  /**
   * Seek to a specific time
   * @param {number} time - Time in seconds
   */
  seek(time) {
    if (this.element) {
      this.element.currentTime = time;
    }
  }

  /**
   * Current playback rate (1.0 = normal). Read from cached JS state, not
   * the DOM, because the element value resets on source swaps.
   * @returns {number}
   */
  get playbackRate() {
    return this._playbackRate;
  }

  /**
   * Whether pitch is preserved when the playback rate changes.
   * @returns {boolean}
   */
  get preservesPitch() {
    return this._preservePitch;
  }

  /**
   * Set audio playback rate, with optional pitch preservation.
   *
   * - With `preservePitch=true` (default), the song stays in key but
   *   artifacts above ~2× because we exceed Chrome's stretch algorithm's
   *   sweet spot. Clamped to [0.5, 2.0].
   * - With `preservePitch=false`, classic "DDR rate mod" chipmunk effect.
   *   Clamped to [0.5, 3.0] — past 3× even the raw resampler sounds bad
   *   and lookup tables in note timing get unreliable.
   *
   * The chosen rate is cached so it can be re-applied when a new song
   * loads (some browsers reset `playbackRate` on a `<source>` swap). The
   * vendor-prefixed properties are set on every call: `preservesPitch`
   * (standard / Chrome 92+), `mozPreservesPitch` (Firefox), and
   * `webkitPreservesPitch` (Safari 18+ on macOS). Setting all three is a
   * no-op on browsers that don't recognize the property.
   *
   * @param {number} rate
   * @param {boolean} [preservePitch=this._preservePitch]
   * @returns {number} The actual rate after clamping
   */
  setPlaybackRate(rate, preservePitch = this._preservePitch) {
    const max = preservePitch ? RATE_MAX_PITCH_PRESERVED : RATE_MAX_PITCH_FREE;
    const clamped = Math.max(RATE_MIN, Math.min(max, rate));
    const rounded = Math.round(clamped * 100) / 100;

    this._playbackRate = rounded;
    this._preservePitch = preservePitch;

    if (this.element) {
      this.element.playbackRate = rounded;
      // Set all three pitch-preservation variants. Browsers ignore unknown
      // properties silently; only one will actually take effect.
      try {
        this.element.preservesPitch = preservePitch;
      } catch {
        /* property may be read-only on older Safari — ignore */
      }
      try {
        this.element.mozPreservesPitch = preservePitch;
      } catch {
        /* not Firefox — ignore */
      }
      try {
        this.element.webkitPreservesPitch = preservePitch;
      } catch {
        /* not Safari — ignore */
      }
    }

    return rounded;
  }

  /**
   * Returns the clamp range for the current pitch-preservation mode so UI
   * can disable buttons at the edges.
   * @returns {{ min: number, max: number }}
   */
  getRateRange() {
    return {
      min: RATE_MIN,
      max: this._preservePitch ? RATE_MAX_PITCH_PRESERVED : RATE_MAX_PITCH_FREE
    };
  }

  /**
   * Reset to beginning and pause
   */
  reset() {
    if (this.element) {
      this.element.currentTime = 0;
      this.element.pause();
    }
  }

  // ===========================================================================
  // LOADING
  // ===========================================================================

  /**
   * Clean up any existing blob URL to prevent memory leaks
   */
  cleanupBlobUrl() {
    if (this._currentBlobUrl) {
      URL.revokeObjectURL(this._currentBlobUrl);
      this._currentBlobUrl = null;
    }
  }

  /**
   * Load audio from a URL
   * @param {string} url - Audio URL
   * @param {string} [type='audio/mpeg'] - MIME type
   * @returns {Promise<void>} Resolves when audio can play
   */
  loadUrl(url, type = 'audio/mpeg') {
    return new Promise((resolve, reject) => {
      if (!this.element) {
        reject(new Error('Audio not initialized'));
        return;
      }

      // Note: Don't cleanup blob URL here - loadBlob() handles its own cleanup
      // before creating a new blob. Cleaning up here would revoke the URL
      // that loadBlob() just created.

      // Set up one-time listeners for load completion
      const onCanPlay = () => {
        this.element.removeEventListener('error', onError);
        // Re-apply rate + pitch preservation: Chrome and Safari reset
        // playbackRate on a fresh <source> in some scenarios, and the
        // pitch-preserve flag is similarly volatile. Cheap to set even
        // when unchanged.
        this.setPlaybackRate(this._playbackRate, this._preservePitch);
        resolve();
      };

      const onError = (e) => {
        this.element.removeEventListener('canplay', onCanPlay);
        reject(new Error('Audio failed to load'));
      };

      this.element.addEventListener('canplay', onCanPlay, { once: true });
      this.element.addEventListener('error', onError, { once: true });

      // Load the audio
      this.element.innerHTML = `<source src="${url}" type="${type}" />`;
      this.element.load();
    });
  }

  /**
   * Load audio from a Blob (creates and tracks blob URL)
   * @param {Blob} blob - Audio blob
   * @param {string} [type='audio/mpeg'] - MIME type
   * @returns {Promise<void>} Resolves when audio can play
   */
  loadBlob(blob, type = 'audio/mpeg') {
    // Clean up previous blob URL
    this.cleanupBlobUrl();

    // Create new blob URL
    this._currentBlobUrl = URL.createObjectURL(blob);

    return this.loadUrl(this._currentBlobUrl, type);
  }

  /**
   * Load audio from ArrayBuffer (for proxied downloads)
   * @param {ArrayBuffer} arrayBuffer - Audio data
   * @param {string} [mimeType='audio/mpeg'] - MIME type
   * @returns {Promise<void>}
   */
  loadArrayBuffer(arrayBuffer, mimeType = 'audio/mpeg') {
    const blob = new Blob([arrayBuffer], { type: mimeType });
    return this.loadBlob(blob, mimeType);
  }

  /**
   * Get the current blob URL if one exists
   * @returns {string|null}
   */
  getCurrentBlobUrl() {
    return this._currentBlobUrl;
  }

  // ===========================================================================
  // EVENT SUBSCRIPTION
  // ===========================================================================

  /**
   * Subscribe to play events
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  onPlay(callback) {
    return this._subscribe('play', callback);
  }

  /**
   * Subscribe to pause events
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  onPause(callback) {
    return this._subscribe('pause', callback);
  }

  /**
   * Subscribe to seeked events
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  onSeeked(callback) {
    return this._subscribe('seeked', callback);
  }

  /**
   * Subscribe to ended events
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  onEnded(callback) {
    return this._subscribe('ended', callback);
  }

  /**
   * Subscribe to canplay events
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  onCanPlay(callback) {
    return this._subscribe('canplay', callback);
  }

  /**
   * Subscribe to error events
   * @param {Function} callback - Called with error event
   * @returns {Function} Unsubscribe function
   */
  onError(callback) {
    return this._subscribe('error', callback);
  }

  /**
   * Subscribe to timeupdate events
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  onTimeUpdate(callback) {
    return this._subscribe('timeupdate', callback);
  }

  /**
   * Internal subscribe helper
   * @param {string} eventType
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  _subscribe(eventType, callback) {
    if (!this._listeners[eventType]) {
      this._listeners[eventType] = [];
    }
    this._listeners[eventType].push(callback);

    // Return unsubscribe function
    return () => {
      const index = this._listeners[eventType].indexOf(callback);
      if (index > -1) {
        this._listeners[eventType].splice(index, 1);
      }
    };
  }

  /**
   * Remove all listeners for an event type
   * @param {string} eventType
   */
  removeAllListeners(eventType) {
    if (this._listeners[eventType]) {
      this._listeners[eventType] = [];
    }
  }

  // ===========================================================================
  // CLEANUP
  // ===========================================================================

  /**
   * Clean up all resources
   */
  destroy() {
    this._detachElementListeners();
    this.cleanupBlobUrl();

    // Clear all listeners
    Object.keys(this._listeners).forEach((key) => {
      this._listeners[key] = [];
    });

    this.element = null;
  }
}

// Create and export singleton instance
const audioManager = new AudioManager();

// Make globally accessible for non-module scripts. Guarded so this file
// can be imported from Node tests without a window.
if (typeof window !== 'undefined') {
  window.audioManager = audioManager;
}

export { AudioManager, audioManager };
