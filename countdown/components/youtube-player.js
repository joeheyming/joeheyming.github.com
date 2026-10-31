/**
 * YouTube Player Web Component
 * A reusable component for embedding YouTube videos
 */
import { buildYouTubeEmbedUrl, isLeanbackBrowser, youtubeWatchUrl } from './youtube-embed.js';

const YT_ORIGINS = new Set(['https://www.youtube.com', 'https://www.youtube-nocookie.com']);

class YouTubePlayer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._videoId = null;
    this._isPlaying = false;
    this._frameSeq = 0;
    this._onYouTubeMessage = (event) => this._handleYouTubeMessage(event);
  }

  static get observedAttributes() {
    return ['video-id'];
  }

  get videoId() {
    return this._videoId || this.getAttribute('video-id');
  }

  set videoId(val) {
    this._videoId = val;
    if (val) {
      this.setAttribute('video-id', val);
    } else {
      this.removeAttribute('video-id');
    }
  }

  get autoplay() {
    return this.hasAttribute('autoplay');
  }

  get isPlaying() {
    return this._isPlaying;
  }

  connectedCallback() {
    this._ensureControlStyles();
    this.render();
  }

  disconnectedCallback() {
    window.removeEventListener('message', this._onYouTubeMessage);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue && this.shadowRoot.innerHTML) {
      if (name === 'video-id' && newValue) {
        this._videoId = newValue;
      }
    }
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          position: relative;
        }

        .player-container {
          width: 100%;
          height: 100%;
          border-radius: var(--border-radius, 12px);
          overflow: hidden;
          background: #000;
          position: relative;
        }

        .player-container.has-border {
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 0 20px rgba(245, 158, 11, 0.2);
          border: 2px solid rgba(245, 158, 11, 0.3);
        }

        ::slotted(iframe) {
          width: 100%;
          height: 100%;
          border: none;
        }

        .placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #64748b;
          font-family: 'Outfit', sans-serif;
        }

        .controls-slot {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 2;
          display: flex;
          justify-content: center;
          pointer-events: none;
        }

        .controls-slot.is-error {
          top: 0;
          align-items: center;
          background: rgba(0, 0, 0, 0.82);
          pointer-events: auto;
        }
      </style>

      <div class="player-container${this.hasAttribute('bordered') ? ' has-border' : ''}">
        <slot name="iframe">
          <div class="placeholder">No video loaded</div>
        </slot>
        <div class="controls-slot"><slot name="controls"></slot></div>
      </div>
    `;
  }

  play(videoId = null, autoplay = true) {
    if (videoId) {
      this._videoId = videoId;
    }

    if (!this._videoId) {
      console.warn('YouTubePlayer: No video ID provided');
      return;
    }

    // Clean up existing iframe
    this.stop();

    // Look up start time by finding the video key
    let startTime = 0;
    for (const [key, id] of Object.entries(YouTubePlayer.VIDEOS)) {
      if (id === this._videoId && YouTubePlayer.VIDEO_START_TIMES[key]) {
        startTime = YouTubePlayer.VIDEO_START_TIMES[key];
        break;
      }
    }

    const origin = window.location && window.location.origin ? window.location.origin : '';
    const embedUrl = buildYouTubeEmbedUrl(this._videoId, {
      autoplay,
      start: startTime,
      origin
    });
    const permissions = [
      'accelerometer',
      'autoplay',
      'clipboard-write',
      'encrypted-media',
      'gyroscope',
      'picture-in-picture',
      'web-share'
    ].join('; ');

    this._frameSeq += 1;
    const frameId = `${this.id || 'yt'}-frame-${this._frameSeq}`;

    // Create iframe in light DOM for YouTube compatibility
    const iframe = document.createElement('iframe');
    iframe.slot = 'iframe';
    iframe.id = frameId;
    iframe.src = embedUrl;
    iframe.title = 'YouTube Video Player';
    // Only needed when the page is cross-origin isolated. Always setting it
    // partitions the frame and can make a TV WebView drop the Referer YouTube
    // requires, or refuse Widevine playback.
    if (globalThis.crossOriginIsolated) {
      iframe.setAttribute('credentialless', '');
    }
    // YouTube error 153 ("Video unavailable") when the embed request has no Referer.
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    iframe.allow = permissions;
    iframe.allowFullscreen = true;
    iframe.style.cssText = 'width: 100%; height: 100%; border: none;';
    iframe.addEventListener('load', () => this._listenToPlayer(iframe));

    this.appendChild(iframe);
    window.addEventListener('message', this._onYouTubeMessage);
    this._isPlaying = true;
    this._showControls(isLeanbackBrowser(window.navigator.userAgent) ? 'leanback' : 'hidden');

    this.dispatchEvent(
      new CustomEvent('video-play', {
        detail: { videoId: this._videoId },
        bubbles: true,
        composed: true
      })
    );
  }

  stop() {
    window.removeEventListener('message', this._onYouTubeMessage);
    const iframe = this.querySelector('iframe[slot="iframe"]');
    if (iframe) {
      iframe.remove();
    }
    this._hideControls();
    this._isPlaying = false;

    this.dispatchEvent(
      new CustomEvent('video-stop', {
        detail: { videoId: this._videoId },
        bubbles: true,
        composed: true
      })
    );
  }

  toggle(videoId = null) {
    if (this._isPlaying) {
      this.stop();
    } else {
      this.play(videoId);
    }
  }

  _listenToPlayer(iframe) {
    if (!iframe.isConnected || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: 'listening', id: iframe.id, channel: 'widget' }),
      'https://www.youtube.com'
    );
  }

  _postCommand(func) {
    const iframe = this.querySelector('iframe[slot="iframe"]');
    if (!iframe || !iframe.contentWindow) return;
    this._listenToPlayer(iframe);
    iframe.contentWindow.postMessage(
      JSON.stringify({
        event: 'command',
        func,
        args: [],
        id: iframe.id,
        channel: 'widget'
      }),
      'https://www.youtube.com'
    );
  }

  _handleYouTubeMessage(event) {
    const iframe = this.querySelector('iframe[slot="iframe"]');
    if (!iframe || event.source !== iframe.contentWindow) return;
    if (!YT_ORIGINS.has(event.origin)) return;

    let data = event.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    if (!data || typeof data !== 'object') return;

    if (data.event === 'onError') {
      const code = typeof data.info === 'number' ? data.info : Number(data.info);
      this._showControls('error', Number.isFinite(code) ? code : 0);
      return;
    }

    const state =
      data.event === 'onStateChange' && typeof data.info === 'number'
        ? data.info
        : data.event === 'infoDelivery' && data.info && typeof data.info.playerState === 'number'
        ? data.info.playerState
        : null;
    // 1 = playing. The TV overlay can come down once the frame is actually going.
    if (state === 1) this._hideControls();
  }

  _ensureControls() {
    let controls = this.querySelector('[data-embed-controls]');
    if (controls) return controls;

    controls = document.createElement('div');
    controls.dataset.embedControls = '';
    controls.slot = 'controls';
    controls.hidden = true;

    const message = document.createElement('p');
    message.dataset.embedMessage = '';

    const play = document.createElement('button');
    play.type = 'button';
    play.dataset.embedPlay = '';
    play.textContent = 'Play';
    play.addEventListener('click', () => this._postCommand('playVideo'));

    const watch = document.createElement('a');
    watch.dataset.embedWatch = '';
    watch.textContent = 'Watch on YouTube';

    controls.append(message, play, watch);
    this.appendChild(controls);
    return controls;
  }

  /**
   * @param {'hidden' | 'leanback' | 'error'} mode
   * @param {number} [errorCode]
   */
  _showControls(mode, errorCode = 0) {
    const controls = this._ensureControls();
    const message = controls.querySelector('[data-embed-message]');
    const play = controls.querySelector('[data-embed-play]');
    const watch = controls.querySelector('[data-embed-watch]');
    const slot = this.shadowRoot.querySelector('.controls-slot');
    if (!message || !play || !watch || !slot) return;

    if (mode === 'hidden') {
      this._hideControls();
      return;
    }

    const leanback = mode === 'leanback';
    watch.href = youtubeWatchUrl(this._videoId || '');
    if (leanback) {
      watch.removeAttribute('target');
      watch.removeAttribute('rel');
    } else {
      watch.target = '_blank';
      watch.rel = 'noopener noreferrer';
    }

    message.hidden = leanback;
    message.textContent = leanback
      ? ''
      : "This browser can't play the video" + (errorCode ? ` (error ${errorCode})` : '') + '.';
    play.hidden = !leanback;
    controls.hidden = false;
    slot.classList.toggle('is-error', !leanback);

    const focusTarget = leanback ? play : watch;
    // A just-inserted control can throw on older TV WebViews.
    try {
      focusTarget.focus();
    } catch {
      /* focus is a convenience, not required for the control to exist */
    }
  }

  _hideControls() {
    const controls = this.querySelector('[data-embed-controls]');
    if (controls) controls.hidden = true;
    const slot = this.shadowRoot && this.shadowRoot.querySelector('.controls-slot');
    if (slot) slot.classList.remove('is-error');
  }

  _ensureControlStyles() {
    if (document.getElementById('youtube-player-controls')) return;
    const style = document.createElement('style');
    style.id = 'youtube-player-controls';
    style.textContent = `
      youtube-player [data-embed-controls] {
        width: 100%;
        box-sizing: border-box;
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        padding: 14px 16px 16px;
        font-family: 'Outfit', system-ui, sans-serif;
        text-align: center;
      }

      youtube-player [data-embed-controls][hidden] {
        display: none !important;
      }

      youtube-player [data-embed-message] {
        margin: 0;
        color: #f8fafc;
        font-size: 1rem;
        line-height: 1.4;
      }

      youtube-player [data-embed-play],
      youtube-player [data-embed-watch] {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 10px 18px;
        border-radius: 10px;
        font: 600 1rem 'Outfit', system-ui, sans-serif;
        text-decoration: none;
        cursor: pointer;
      }

      youtube-player [data-embed-play] {
        border: none;
        background: #f59e0b;
        color: #0a0a18;
      }

      youtube-player [data-embed-watch] {
        border: 1px solid rgba(251, 191, 36, 0.7);
        background: rgba(15, 23, 42, 0.85);
        color: #fbbf24;
      }

      youtube-player [data-embed-play]:focus-visible,
      youtube-player [data-embed-watch]:focus-visible {
        outline: 3px solid #fff;
        outline-offset: 2px;
      }
    `;
    document.head.appendChild(style);
  }
}

// Well-known celebration/countdown videos
YouTubePlayer.VIDEOS = {
  CELEBRATION: '3GwjfUFyY6M', // Kool & The Gang - Celebration
  FINAL_COUNTDOWN: '9jK-NcRmVcw', // Europe - The Final Countdown
  AULD_LANG_SYNE: 'lvJRmdN9iyU', // Traditional Auld Lang Syne
  HAPPY_NEW_YEAR: '3Uo0JAUWijM', // ABBA - Happy New Year (AbbaVEVO)
  FIREWORK: 'QGJuMBdaqIw', // Katy Perry - Firework
  PARTY_ROCK: 'KQ6zr6kCPj8', // LMFAO - Party Rock Anthem
  DONT_STOP: '1k8craCGpgs', // Journey - Don't Stop Believin'
  GOOD_FEELING: '3OnnDqH6Wj8', // Flo Rida - Good Feeling
  TIME_OF_MY_LIFE: 'WpmILPAcRQo', // Dirty Dancing - Time of My Life
  HAPPY: 'ZbZSe6N_BXs', // Pharrell Williams - Happy
  UPTOWN_FUNK: 'OPf0YbXqDm0', // Bruno Mars - Uptown Funk
  CANT_STOP_FEELING: 'ru0K8uYEZWw' // Justin Timberlake - Can't Stop the Feeling
};

// Start times (in seconds) to skip intros/dialog - only needed for videos with long intros
YouTubePlayer.VIDEO_START_TIMES = {
  PARTY_ROCK: 100, // Skip the shuffling intro skit
  TIME_OF_MY_LIFE: 28, // Skip the movie dialog
  GOOD_FEELING: 15, // Skip the slow intro
  UPTOWN_FUNK: 5, // Small intro
  HAPPY: 5,
  FINAL_COUNTDOWN: 13,
  AULD_LANG_SYNE: 13
};

// Video metadata for UI display
YouTubePlayer.VIDEO_METADATA = {
  CELEBRATION: { label: 'Celebration', artist: 'Kool & The Gang', emoji: '🎉' },
  AULD_LANG_SYNE: { label: 'Auld Lang Syne', artist: 'Traditional', emoji: '🎆' },
  HAPPY_NEW_YEAR: { label: 'Happy New Year', artist: 'ABBA', emoji: '🥂' },
  FIREWORK: { label: 'Firework', artist: 'Katy Perry', emoji: '🎇' },
  PARTY_ROCK: { label: 'Party Rock Anthem', artist: 'LMFAO', emoji: '🪩' },
  DONT_STOP: { label: "Don't Stop Believin'", artist: 'Journey', emoji: '🌟' },
  GOOD_FEELING: { label: 'Good Feeling', artist: 'Flo Rida', emoji: '✨' },
  TIME_OF_MY_LIFE: { label: 'Time of My Life', artist: 'Dirty Dancing', emoji: '💃' },
  HAPPY: { label: 'Happy', artist: 'Pharrell Williams', emoji: '😊' },
  UPTOWN_FUNK: { label: 'Uptown Funk', artist: 'Bruno Mars', emoji: '🕺' },
  CANT_STOP_FEELING: { label: "Can't Stop the Feeling", artist: 'Justin Timberlake', emoji: '🎶' }
};

// Default celebration videos for specific events
YouTubePlayer.EVENT_DEFAULTS = {
  'new-years': 'AULD_LANG_SYNE',
  'new-years-eve': 'AULD_LANG_SYNE',
  christmas: 'HAPPY_NEW_YEAR',
  independence: 'FIREWORK',
  birthday: 'HAPPY'
};

customElements.define('youtube-player', YouTubePlayer);
export default YouTubePlayer;
