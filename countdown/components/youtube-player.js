/**
 * YouTube Player Web Component
 * A reusable component for embedding YouTube videos
 */
class YouTubePlayer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._videoId = null;
    this._isPlaying = false;
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
    this.render();
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
      </style>

      <div class="player-container${this.hasAttribute('bordered') ? ' has-border' : ''}">
        <slot name="iframe">
          <div class="placeholder">No video loaded</div>
        </slot>
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

    let embedUrl = `https://www.youtube.com/embed/${this._videoId}?rel=0&autoplay=${
      autoplay ? 1 : 0
    }`;
    if (startTime > 0) {
      embedUrl += `&start=${startTime}`;
    }
    const permissions = [
      'accelerometer',
      'autoplay',
      'clipboard-write',
      'encrypted-media',
      'gyroscope',
      'picture-in-picture',
      'web-share'
    ].join('; ');

    // Create iframe in light DOM for YouTube compatibility
    const iframe = document.createElement('iframe');
    iframe.slot = 'iframe';
    iframe.src = embedUrl;
    iframe.title = 'YouTube Video Player';
    iframe.setAttribute('credentialless', ''); // Allow YouTube to work with COEP enabled
    iframe.allow = permissions;
    iframe.allowFullscreen = true;
    iframe.style.cssText = 'width: 100%; height: 100%; border: none;';

    this.appendChild(iframe);
    this._isPlaying = true;

    this.dispatchEvent(
      new CustomEvent('video-play', {
        detail: { videoId: this._videoId },
        bubbles: true,
        composed: true
      })
    );
  }

  stop() {
    const iframe = this.querySelector('iframe[slot="iframe"]');
    if (iframe) {
      iframe.remove();
    }
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
}

// Well-known celebration/countdown videos
YouTubePlayer.VIDEOS = {
  CELEBRATION: '3GwjfUFyY6M', // Kool & The Gang - Celebration
  FINAL_COUNTDOWN: '9jK-NcRmVcw', // Europe - The Final Countdown
  AULD_LANG_SYNE: 'lvJRmdN9iyU', // Traditional Auld Lang Syne
  HAPPY_NEW_YEAR: 'oUfnfIhsGss', // ABBA - Happy New Year
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
