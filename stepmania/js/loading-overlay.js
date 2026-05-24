// Loading Overlay Web Component - ES Module
// Self-contained loading/progress overlay with multiple states

import { adoptSharedStyles } from './sharedStyles.js';
import { createComponentProxy } from './componentProxy.js';
import { logVideoLoad } from './videoLoadLogging.js';
import { videoContextStatusMessage } from './videoContextCopy.js';

/**
 * Loading Overlay States
 */
const STATES = {
  LOADING: 'loading',
  ERROR: 'error',
  READY: 'ready',
  HIDDEN: 'hidden'
};

class LoadingOverlayElement extends HTMLElement {
  /** @type {LoadingOverlayElement|null} */
  static _instance = null;

  /**
   * Get the singleton instance of the loading overlay
   * @returns {LoadingOverlayElement|null}
   */
  static get() {
    if (!LoadingOverlayElement._instance) {
      LoadingOverlayElement._instance = document.getElementById('loading-overlay');
    }
    return LoadingOverlayElement._instance;
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // Internal state
    this._state = STATES.HIDDEN;
    this._title = '';
    this._status = '';
    this._progress = 0;
    this._charts = [];
    this._currentDifficulty = 0;

    // Video state
    this._hasVideo = false;
    this._videoStatus = null;
    this._videoProgress = 0;

    // Callbacks
    this._onPlay = null;
    this._onBrowse = null;
    this._onRetry = null;
    this._onBack = null;
    this._onDifficultyChange = null;
  }

  connectedCallback() {
    this.render();
    adoptSharedStyles(this.shadowRoot);
    this.bindEvents();
  }

  /**
   * Render the loading overlay UI
   */
  render() {
    const isHidden = this._state === STATES.HIDDEN;
    const isLoading = this._state === STATES.LOADING;
    const isError = this._state === STATES.ERROR;
    const isReady = this._state === STATES.READY;

    const difficultyClass = !isReady || this._charts.length === 0 ? 'hidden' : '';
    const difficultyOptions = this._charts
      .map((chart, i) => {
        const selected = i === this._currentDifficulty ? 'selected' : '';
        return `<option value="${i}" ${selected}>${chart.difficulty} (${chart.rating})</option>`;
      })
      .join('');

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }
        /* All chrome routes through /brand.css custom properties (which
         * inherit through the shadow boundary). The previous palette
         * (purple #a855f7, gray-700 #374151, etc.) was a fixed dark
         * theme — this version reuses brand surfaces so a theme swap
         * re-tints the loading overlay without touching this module. */
        .overlay {
          position: fixed;
          inset: 0;
          background: var(--scrim-strong);
          z-index: 70;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .overlay.hidden {
          display: none;
        }
        .content {
          text-align: center;
          max-width: 400px;
          padding: 1rem;
        }
        .spinner {
          display: inline-block;
          width: 4rem;
          height: 4rem;
          border: 4px solid var(--accent-primary);
          border-top-color: transparent;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-bottom: 1.5rem;
        }
        .spinner.hidden { display: none; }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .error-icon {
          display: inline-flex;
          width: 4rem;
          height: 4rem;
          background: var(--danger);
          border-radius: 50%;
          margin-bottom: 1.5rem;
          align-items: center;
          justify-content: center;
          font-size: 1.5rem;
        }
        .error-icon.hidden { display: none; }
        .title {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--pure-white);
          margin-bottom: 0.5rem;
        }
        .status {
          color: var(--pure-white);
          opacity: 0.85;
          margin-bottom: 1rem;
        }
        .progress-container {
          margin-top: 1rem;
          width: 16rem;
          background: var(--surface-2);
          border-radius: 9999px;
          height: 0.5rem;
          margin-left: auto;
          margin-right: auto;
        }
        .progress-container.hidden { display: none; }
        .progress-bar {
          background: var(--accent-primary);
          height: 0.5rem;
          border-radius: 9999px;
          transition: width 0.3s ease;
        }
        .buttons {
          margin-top: 1rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.75rem;
        }
        @media (min-width: 640px) {
          .buttons {
            flex-direction: row;
            justify-content: center;
          }
        }
        .buttons.hidden { display: none; }
        button {
          padding: 0.5rem 1.5rem;
          font-weight: 600;
          border-radius: 0.5rem;
          border: none;
          cursor: pointer;
          transition: filter 0.2s;
          color: var(--text-on-accent);
        }
        button:hover { filter: brightness(0.92); }
        .btn-play {
          background: var(--success);
        }
        .btn-browse {
          background: var(--accent-primary);
        }
        .btn-retry {
          background: var(--accent-primary);
        }
        .btn-back {
          background: var(--surface-2);
          color: var(--text-1);
        }
        .hidden { display: none !important; }
        .difficulty-container {
          margin-top: 1rem;
          text-align: center;
        }
        .difficulty-container.hidden { display: none; }
        .difficulty-label {
          display: block;
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--pure-white);
          opacity: 0.85;
          margin-bottom: 0.5rem;
        }
        .difficulty-select {
          padding: 0.5rem 1rem;
          background: var(--surface-1);
          border: 1px solid var(--hairline-strong);
          border-radius: 0.5rem;
          color: var(--text-1);
          font-size: 1rem;
        }
        .difficulty-select:focus {
          outline: none;
          box-shadow: 0 0 0 2px var(--accent-primary);
          border-color: transparent;
        }
        .video-status {
          margin-top: 1rem;
          padding: 0.5rem 1rem;
          border-radius: 0.5rem;
          font-size: 0.875rem;
          display: block;
          max-width: 100%;
          line-height: 1.45;
          text-align: left;
        }
        .video-status.hidden {
          display: none;
        }
        .video-pending {
          background: var(--surface-2);
          color: var(--text-2);
        }
        .video-loading {
          background: var(--accent-primary-soft);
          color: var(--accent-primary);
          animation: pulse 1.5s ease-in-out infinite;
        }
        .video-ready {
          background: var(--success-soft);
          color: var(--success);
        }
        .video-failed {
          background: var(--danger-soft);
          color: var(--danger);
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      </style>

      <div class="overlay ${isHidden ? 'hidden' : ''}" id="overlay">
        <div class="content">
          <!-- Spinner -->
          <div class="spinner ${!isLoading ? 'hidden' : ''}" id="spinner"></div>
          
          <!-- Error Icon -->
          <div class="error-icon ${!isError ? 'hidden' : ''}" id="error-icon">⚠️</div>
          
          <!-- Title & Status -->
          <h2 class="title" id="title">${this._title}</h2>
          <p class="status" id="status">${this._status}</p>
          
          <!-- Progress Bar -->
          <div class="progress-container ${!isLoading ? 'hidden' : ''}" id="progress-container">
            <div class="progress-bar" id="progress-bar" style="width: ${this._progress}%"></div>
          </div>
          
          <!-- Loading Cancel Button -->
          <div class="buttons ${
            !isLoading ? 'hidden' : ''
          }" id="loading-buttons" style="margin-top: 1rem;">
            <button class="btn-browse" id="loading-browse-btn">📚 Choose Different Song</button>
          </div>
          
          <!-- Error Buttons -->
          <div class="buttons ${!isError ? 'hidden' : ''}" id="error-buttons">
            <button class="btn-retry" id="retry-btn">Retry</button>
            <button class="btn-back" id="back-btn">Back to Browser</button>
          </div>
          
          <!-- Ready Buttons -->
          <div class="buttons ${!isReady ? 'hidden' : ''}" id="ready-buttons">
            <button class="btn-play" id="play-btn">🎵 Start Playing</button>
            <button class="btn-browse" id="browse-btn">📚 Song Browser</button>
          </div>
          
          <!-- Back button for ready state -->
          <div class="buttons ${!isReady ? 'hidden' : ''}" style="margin-top: 0.5rem;">
            <button class="btn-back" id="ready-back-btn">← Back</button>
          </div>
          
          <!-- Difficulty Selector -->
          <div class="difficulty-container ${difficultyClass}" id="difficulty-container">
            <label class="difficulty-label" for="difficulty-select">Select Difficulty:</label>
            <select class="difficulty-select" id="difficulty-select" aria-label="Difficulty">
              ${difficultyOptions}
            </select>
          </div>
          
          <!-- Video Status -->
          <div id="video-status" class="video-status ${
            this._hasVideo ? 'video-pending' : 'hidden'
          }">
            ${this._hasVideo ? '🎬 Preparing video...' : ''}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    const playBtn = this.shadowRoot.getElementById('play-btn');
    const browseBtn = this.shadowRoot.getElementById('browse-btn');
    const retryBtn = this.shadowRoot.getElementById('retry-btn');
    const backBtn = this.shadowRoot.getElementById('back-btn');
    const readyBackBtn = this.shadowRoot.getElementById('ready-back-btn');
    const loadingBrowseBtn = this.shadowRoot.getElementById('loading-browse-btn');
    const difficultySelect = this.shadowRoot.getElementById('difficulty-select');

    if (playBtn) {
      playBtn.addEventListener('click', () => {
        if (this._onPlay) this._onPlay();
      });
    }

    if (browseBtn) {
      browseBtn.addEventListener('click', () => {
        if (this._onBrowse) this._onBrowse();
      });
    }

    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        if (this._onRetry) this._onRetry();
      });
    }

    if (backBtn) {
      backBtn.addEventListener('click', () => {
        if (this._onBack) this._onBack();
      });
    }

    if (readyBackBtn) {
      readyBackBtn.addEventListener('click', () => {
        if (this._onBack) this._onBack();
      });
    }

    // Loading state browse button - opens song browser
    if (loadingBrowseBtn) {
      loadingBrowseBtn.addEventListener('click', () => {
        this.hide();
        const zeniusBrowser = document.querySelector('zenius-browser');
        if (zeniusBrowser && typeof zeniusBrowser.showBrowser === 'function') {
          zeniusBrowser.showBrowser();
        }
        // Clear URL params to prevent reloading the same song
        window.history.pushState({}, '', window.location.pathname);
      });
    }

    if (difficultySelect) {
      difficultySelect.addEventListener('change', (e) => {
        const index = parseInt(e.target.value);
        this._currentDifficulty = index;
        if (this._onDifficultyChange) this._onDifficultyChange(index);
      });
    }
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Show loading state with progress
   * @param {string} songTitle - Song being loaded
   * @param {string} status - Status message
   * @param {number} progress - Progress 0-100
   */
  showLoading(songTitle, status = 'Preparing audio and charts...', progress = 0) {
    this._state = STATES.LOADING;
    this._title = `Loading ${songTitle}...`;
    this._status = status;
    this._progress = progress;
    this.render();
    this.bindEvents();
  }

  /**
   * Update progress during loading
   * @param {string} status - New status message
   * @param {number} progress - Progress 0-100
   */
  updateProgress(status, progress) {
    this._status = status;
    this._progress = progress;

    const statusEl = this.shadowRoot.getElementById('status');
    const progressBar = this.shadowRoot.getElementById('progress-bar');

    if (statusEl) statusEl.textContent = status;
    if (progressBar) progressBar.style.width = `${progress}%`;
  }

  /**
   * Show error state
   * @param {string} title - Error title
   * @param {string} message - Error message
   * @param {Object} options - Optional callbacks
   * @param {Function} options.onRetry - Retry callback
   * @param {Function} options.onBack - Back callback
   */
  showError(title, message, options = {}) {
    this._state = STATES.ERROR;
    this._title = title;
    this._status = message;

    // Set callbacks with defaults
    this._onRetry = options.onRetry || (() => window.location.reload());
    this._onBack =
      options.onBack ||
      (() => {
        // Default: open the zenius browser dialog
        const zeniusBrowser = document.querySelector('zenius-browser');
        if (zeniusBrowser && typeof zeniusBrowser.showBrowser === 'function') {
          this.hide();
          zeniusBrowser.showBrowser();
        } else {
          // Fallback: just hide and go to base URL
          this.hide();
          window.history.pushState({}, '', window.location.pathname);
        }
      });

    this.render();
    this.bindEvents();
  }

  /**
   * Show ready to play state
   * @param {Object} options - Configuration
   * @param {Function} options.onPlay - Play callback
   * @param {Function} options.onBrowse - Browse callback
   * @param {Function} options.onBack - Back callback
   * @param {Function} options.onDifficultyChange - Difficulty change callback
   * @param {Array} options.charts - Available charts
   * @param {number} options.currentDifficulty - Current difficulty index
   */
  showReadyToPlay(options = {}) {
    const {
      onPlay,
      onBrowse,
      onBack,
      onDifficultyChange,
      charts = [],
      currentDifficulty = 0,
      hasVideo = false
    } = options;

    this._state = STATES.READY;
    this._title = 'Ready to Play!';
    this._status = 'Click the Start Playing button to begin';
    this._charts = charts;
    this._currentDifficulty = currentDifficulty;
    this._onPlay = onPlay;
    this._onBrowse = onBrowse;
    this._onBack = onBack;
    this._onDifficultyChange = onDifficultyChange;
    this._hasVideo = hasVideo;
    this._videoStatus = hasVideo ? 'pending' : null; // pending, loading, ready, failed, unavailable
    this._videoProgress = 0;

    this.render();
    this.bindEvents();
  }

  /**
   * Update video loading status
   * @param {string} status - 'loading', 'ready', 'failed', 'unavailable'
   * @param {number} progress - Progress percentage (0-100) for loading status
   */
  updateVideoStatus(status, progress = 0) {
    this._videoStatus = status;
    this._videoProgress = progress;

    let statusText = '';
    let statusClass = '';

    switch (status) {
      case 'loading':
        statusText = `🎬 Converting video... ${progress}%`;
        statusClass = 'video-loading';
        break;
      case 'ready':
        statusText = '🎬 Video ready!';
        statusClass = 'video-ready';
        break;
      case 'failed':
        statusText = '🎬 Video unavailable (using background)';
        statusClass = 'video-failed';
        break;
      case 'unavailable':
        statusText = videoContextStatusMessage('preloadOverlay');
        statusClass = 'video-failed';
        break;
      default:
        statusText = '🎬 Preparing video...';
        statusClass = 'video-pending';
    }

    // Source-of-truth log: always runs when the overlay line changes (avoids missing callers / log level).
    logVideoLoad('overlay.updateVideoStatus', {
      status,
      progress,
      statusText,
      hasShadowRoot: !!this.shadowRoot
    });

    // Update the video status element if it exists
    const videoStatusEl = this.shadowRoot?.getElementById('video-status');
    if (videoStatusEl) {
      videoStatusEl.textContent = statusText;
      videoStatusEl.className = `video-status ${statusClass}`;
    } else if (status) {
      logVideoLoad('overlay.updateVideoStatus.noElement', {
        status,
        note: 'video-status not in shadow DOM yet (message may be stale until next render)'
      });
    }
  }

  /**
   * Hide the overlay
   */
  hide() {
    this._state = STATES.HIDDEN;
    const overlay = this.shadowRoot.getElementById('overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  /**
   * Set retry/back handlers
   * @param {Function} onRetry - Retry callback
   * @param {Function} onBack - Back callback
   */
  setErrorHandlers(onRetry, onBack) {
    this._onRetry = onRetry;
    this._onBack = onBack;
  }

  /**
   * Get current state
   * @returns {string}
   */
  get state() {
    return this._state;
  }
}

// Register the web component
customElements.define('loading-overlay', LoadingOverlayElement);

// Create proxy for singleton access: LoadingOverlay.showLoading(...) instead of LoadingOverlay.get()?.showLoading(...)
export const LoadingOverlay = createComponentProxy(LoadingOverlayElement);

export default LoadingOverlay;
