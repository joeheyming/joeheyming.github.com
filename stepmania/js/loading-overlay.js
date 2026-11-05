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

/** @param {unknown} value */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {string} difficulty
 * @returns {string}
 */
function difficultyTone(difficulty) {
  const tones = {
    beginner: 'b',
    easy: 'l',
    basic: 'l',
    light: 'l',
    medium: 's',
    difficult: 's',
    standard: 's',
    another: 's',
    hard: 'h',
    expert: 'h',
    heavy: 'h',
    challenge: 'c',
    edit: 'e'
  };
  return tones[String(difficulty || '').toLowerCase()] || 'u';
}

/**
 * @param {{ difficulty?: string, rating?: number }|undefined} chart
 * @returns {string}
 */
function startLabel(chart) {
  if (!chart) return 'Start';
  const name = chart.difficulty || 'Chart';
  const rating = Number(chart.rating);
  return Number.isFinite(rating) && rating > 0 ? `Start · ${name} ${rating}` : `Start · ${name}`;
}

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
    this._onCancel = null;
    this._onDifficultyChange = null;
    this._allowRetry = true;
    this._artist = '';
    this._audioReady = true;
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
    const showCharts = isReady && this._charts.length > 0;
    const showVideo =
      isReady &&
      this._hasVideo &&
      (this._videoStatus === 'pending' || this._videoStatus === 'loading');
    const chart = this._charts[this._currentDifficulty];
    const waitingForAudio = isReady && !this._audioReady;
    const hideStatus = !this._status || (isReady && this._audioReady);
    const chartsHtml = this._charts
      .map((item, i) => {
        const tone = difficultyTone(item.difficulty);
        const pressed = i === this._currentDifficulty ? 'true' : 'false';
        return `<button type="button" class="chart-choice tone-${tone}" data-index="${i}" aria-pressed="${pressed}">
          <span class="chart-name">${escapeHtml(item.difficulty || 'Chart')}</span>
          <span class="chart-rating">${escapeHtml(item.rating ?? '')}</span>
        </button>`;
      })
      .join('');

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .overlay {
          position: fixed;
          inset: 0;
          z-index: 70;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1.25rem;
          background: color-mix(in srgb, var(--pure-black) 62%, transparent);
          backdrop-filter: blur(8px);
        }
        .overlay.hidden { display: none; }
        .card {
          width: min(100%, 32rem);
          padding: 1.6rem 1.35rem 1.2rem;
          border-radius: 1.25rem;
          border: 1px solid var(--hairline-accent);
          background: linear-gradient(180deg, var(--surface-1), var(--surface-0));
          box-shadow: 0 28px 70px color-mix(in srgb, var(--pure-black) 45%, transparent);
          text-align: center;
        }
        .spinner {
          width: 2.4rem;
          height: 2.4rem;
          margin: 0 auto 1rem;
          border: 3px solid color-mix(in srgb, var(--accent-primary) 35%, transparent);
          border-top-color: var(--accent-primary);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .error-mark {
          width: 2.6rem;
          height: 2.6rem;
          margin: 0 auto 0.9rem;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: color-mix(in srgb, var(--danger) 18%, transparent);
          color: var(--danger);
          font-weight: 800;
          font-size: 1.25rem;
        }
        .title {
          margin: 0;
          font-size: 1.55rem;
          line-height: 1.2;
          font-weight: 750;
          color: var(--text-1);
          overflow-wrap: anywhere;
        }
        .artist {
          margin: 0.35rem 0 0;
          color: var(--text-2);
          font-size: 0.95rem;
        }
        .status {
          margin: 0.7rem 0 0;
          color: var(--text-2);
          font-size: 0.95rem;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }
        .chart-list {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 0.5rem;
          margin: 1.1rem 0 0.2rem;
        }
        .chart-choice {
          flex: 1 1 4.5rem;
          max-width: 6.2rem;
          min-width: 4.4rem;
          padding: 0.45rem 0.55rem 0.4rem;
          border: 0;
          border-radius: 0.8rem;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.05rem;
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pure-black) 18%, transparent);
        }
        .chart-choice[aria-pressed="true"] {
          outline: 2px solid var(--text-1);
          outline-offset: 3px;
        }
        .chart-choice:focus-visible {
          outline: 3px solid var(--warning);
          outline-offset: 3px;
        }
        .chart-name {
          font-size: 0.65rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .chart-rating {
          font-size: 1.25rem;
          font-weight: 800;
          line-height: 1.1;
        }
        .tone-b {
          background: linear-gradient(135deg, var(--sm-badge-sky-lo, #0ea5e9), var(--sm-badge-sky-hi, #38bdf8));
          color: var(--pure-black);
        }
        .tone-l {
          background: linear-gradient(135deg, var(--sm-badge-orange-lo, #f97316), var(--sm-badge-orange-hi, #fb923c));
          color: var(--pure-black);
        }
        .tone-s {
          background: linear-gradient(135deg, var(--sm-badge-red-lo, #dc2626), var(--sm-badge-red-hi, #ef4444));
          color: var(--pure-white);
        }
        .tone-h {
          background: linear-gradient(135deg, var(--sm-badge-green-lo, #16a34a), var(--sm-badge-green-hi, #22c55e));
          color: var(--pure-black);
        }
        .tone-c {
          background: linear-gradient(135deg, var(--sm-badge-purple-lo, #9333ea), var(--sm-badge-purple-hi, #a855f7));
          color: var(--pure-white);
        }
        .tone-e {
          background: linear-gradient(135deg, var(--sm-badge-teal-lo, #0d9488), var(--sm-badge-teal-hi, #14b8a6));
          color: var(--pure-white);
        }
        .tone-u {
          background: linear-gradient(135deg, var(--text-3), var(--text-2));
          color: var(--pure-black);
        }
        .actions {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 0.15rem;
          margin-top: 1rem;
        }
        button {
          font: inherit;
          cursor: pointer;
          border: 0;
        }
        /* Dark-theme --success (#56d364) is too light for white type (~2:1).
           The accent, pulled toward black, keeps --text-on-accent readable. */
        .btn-play, .btn-solid {
          width: 100%;
          padding: 0.85rem 1rem;
          border-radius: 0.85rem;
          font-size: 1.05rem;
          font-weight: 700;
          color: var(--text-on-accent);
          background: color-mix(in srgb, var(--accent-primary) 62%, var(--pure-black));
        }
        .btn-play:hover, .btn-solid:hover {
          background: color-mix(in srgb, var(--accent-primary) 78%, var(--pure-black));
        }
        .btn-text {
          background: transparent;
          color: var(--text-2);
          font-weight: 600;
          font-size: 0.92rem;
          padding: 0.55rem 0.4rem;
        }
        .btn-text:hover { color: var(--text-1); }
        button:focus-visible {
          outline: 3px solid var(--warning);
          outline-offset: 3px;
        }
        .video-status {
          margin: 0.85rem 0 0;
          color: var(--text-3);
          font-size: 0.8rem;
          line-height: 1.4;
        }
        .hidden { display: none !important; }
      </style>
      <div
        class="overlay ${isHidden ? 'hidden' : ''}"
        id="overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="title"
        ${!isReady && this._status ? 'aria-describedby="status"' : ''}
        tabindex="-1"
      >
        <div class="card">
          <div class="spinner ${isLoading ? '' : 'hidden'}" id="spinner" aria-hidden="true"></div>
          <div class="error-mark ${
            isError ? '' : 'hidden'
          }" id="error-icon" aria-hidden="true">!</div>
          <h2 class="title" id="title">${escapeHtml(this._title)}</h2>
          <p class="artist ${isReady && this._artist ? '' : 'hidden'}" id="artist">${escapeHtml(
      this._artist
    )}</p>
          <p class="status ${
            hideStatus ? 'hidden' : ''
          }" id="status" aria-live="polite">${escapeHtml(this._status)}</p>
          <div class="chart-list ${
            showCharts ? '' : 'hidden'
          }" id="chart-list" role="group" aria-label="Difficulty">
            ${chartsHtml}
          </div>
          <div class="actions ${isLoading ? '' : 'hidden'}" id="loading-buttons">
            <button type="button" class="btn-text" id="loading-browse-btn">Pick a different song</button>
          </div>
          <div class="actions ${isError ? '' : 'hidden'}" id="error-buttons">
            <button type="button" class="btn-solid ${
              this._allowRetry ? '' : 'hidden'
            }" id="retry-btn">Retry</button>
            <button type="button" class="${
              this._allowRetry ? 'btn-text' : 'btn-solid'
            }" id="back-btn">Pick a different song</button>
          </div>
          <div class="actions ${isReady ? '' : 'hidden'}" id="ready-buttons">
            <button type="button" class="btn-play" id="play-btn" ${
              waitingForAudio ? 'disabled' : ''
            }>${escapeHtml(waitingForAudio ? 'Getting the audio…' : startLabel(chart))}</button>
            <button type="button" class="btn-text" id="ready-back-btn">Pick a different song</button>
          </div>
          <p id="video-status" class="video-status ${showVideo ? 'video-note' : 'hidden'}">${
      showVideo ? 'Background video still converting' : ''
    }</p>
        </div>
      </div>
    `;
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    const playBtn = this.shadowRoot.getElementById('play-btn');
    const retryBtn = this.shadowRoot.getElementById('retry-btn');
    const backBtn = this.shadowRoot.getElementById('back-btn');
    const readyBackBtn = this.shadowRoot.getElementById('ready-back-btn');
    const loadingBrowseBtn = this.shadowRoot.getElementById('loading-browse-btn');
    const chartList = this.shadowRoot.getElementById('chart-list');

    if (playBtn) {
      playBtn.addEventListener('click', () => {
        if (this._onPlay) this._onPlay();
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

    if (loadingBrowseBtn) {
      loadingBrowseBtn.addEventListener('click', () => {
        if (this._onCancel) {
          this._onCancel();
          return;
        }
        this.hide();
        const zeniusBrowser = document.querySelector('zenius-browser');
        if (zeniusBrowser && typeof zeniusBrowser.showBrowser === 'function') {
          zeniusBrowser.showBrowser();
        }
        window.history.pushState({}, '', window.location.pathname);
      });
    }

    if (chartList) {
      chartList.addEventListener('click', (event) => {
        const button =
          event.target instanceof Element ? event.target.closest('.chart-choice') : null;
        if (!(button instanceof HTMLElement)) return;
        this.selectChart(Number(button.dataset.index));
      });
      chartList.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        const count = this._charts.length;
        if (!count) return;
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        const next = (this._currentDifficulty + delta + count) % count;
        this.selectChart(next);
        this.shadowRoot.querySelector('.chart-choice[data-index="' + next + '"]')?.focus();
      });
    }

    const overlay = this.shadowRoot.getElementById('overlay');
    overlay?.addEventListener('keydown', (e) => {
      if (this._state === STATES.HIDDEN) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        const backId =
          this._state === STATES.READY
            ? 'ready-back-btn'
            : this._state === STATES.ERROR
            ? 'back-btn'
            : 'loading-browse-btn';
        this.shadowRoot.getElementById(backId)?.click();
        return;
      }
      if (e.key !== 'Tab') return;
      const controls = this.visibleControls();
      if (controls.length === 0) return;
      const active = this.shadowRoot.activeElement;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  /**
   * @param {number} index
   */
  selectChart(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this._charts.length) return;
    this._currentDifficulty = index;
    this.shadowRoot.querySelectorAll('.chart-choice').forEach((button, i) => {
      button.setAttribute('aria-pressed', i === index ? 'true' : 'false');
    });
    const playBtn = this.shadowRoot.getElementById('play-btn');
    if (playBtn && this._audioReady) playBtn.textContent = startLabel(this._charts[index]);
    if (this._onDifficultyChange) this._onDifficultyChange(index);
  }

  visibleControls() {
    const overlay = this.shadowRoot.getElementById('overlay');
    if (!overlay) return [];
    return [...overlay.querySelectorAll('button, select, a[href], input, textarea')].filter(
      (el) => {
        if (!(el instanceof HTMLElement) || el.disabled) return false;
        let node = el;
        while (node && node !== overlay.parentElement) {
          if (node.hidden) return false;
          const style = getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          node = node.parentElement;
        }
        return true;
      }
    );
  }

  focusPrimaryAction() {
    if (this._state === STATES.LOADING) {
      this.shadowRoot.getElementById('overlay')?.focus();
      return;
    }
    if (this._state === STATES.READY && !this._audioReady) {
      const pressed = this.shadowRoot.querySelector('.chart-choice[aria-pressed="true"]');
      const chartBtn = pressed || this.shadowRoot.querySelector('.chart-choice');
      if (chartBtn instanceof HTMLElement) chartBtn.focus({ focusVisible: true });
      return;
    }
    const id =
      this._state === STATES.READY
        ? 'play-btn'
        : this._state === STATES.ERROR
        ? this._allowRetry
          ? 'retry-btn'
          : 'back-btn'
        : '';
    const target = id ? this.shadowRoot.getElementById(id) : null;
    if (target) target.focus({ focusVisible: true });
  }

  /**
   * @param {string} songTitle
   * @param {string} [status]
   */
  showLoading(songTitle, status = 'Getting the chart') {
    this._state = STATES.LOADING;
    this._title = songTitle || 'Song';
    this._artist = '';
    this._status = status || 'Getting the chart';
    this._charts = [];
    this._hasVideo = false;
    this._videoStatus = null;
    this.render();
    this.bindEvents();
    this.focusPrimaryAction();
  }

  /**
   * The ready screen owns its copy. Later setup work must not rewrite it.
   * @param {string} status
   */
  updateProgress(status) {
    if (this._state === STATES.HIDDEN || (this._state === STATES.READY && this._audioReady)) return;
    this._status = status;
    const statusEl = this.shadowRoot.getElementById('status');
    if (statusEl) statusEl.textContent = status;
  }

  /**
   * @param {string} title
   */
  setTitle(title) {
    const next = String(title || '').trim();
    if (!next || this._state === STATES.READY) return;
    this._title = next;
    const el = this.shadowRoot?.getElementById('title');
    if (el) el.textContent = next;
  }

  /**
   * @param {Function} onCancel
   */
  setCancelHandler(onCancel) {
    this._onCancel = onCancel;
  }

  /**
   * @param {string} title
   * @param {string} message
   * @param {{ onRetry?: Function, onBack?: Function, allowRetry?: boolean }} [options]
   */
  showError(title, message, options = {}) {
    this._state = STATES.ERROR;
    this._title = title;
    this._artist = '';
    this._status = message;
    this._allowRetry = options.allowRetry !== false;

    this._onRetry = options.onRetry || (() => window.location.reload());
    this._onBack =
      options.onBack ||
      (() => {
        const zeniusBrowser = document.querySelector('zenius-browser');
        if (zeniusBrowser && typeof zeniusBrowser.showBrowser === 'function') {
          this.hide();
          zeniusBrowser.showBrowser();
        } else {
          this.hide();
          window.history.pushState({}, '', window.location.pathname);
        }
      });

    this.render();
    this.bindEvents();
    this.focusPrimaryAction();
  }

  /**
   * @param {Object} options
   * @param {string} [options.songTitle]
   * @param {string} [options.artist]
   * @param {Function} [options.onPlay]
   * @param {Function} [options.onBrowse]
   * @param {Function} [options.onBack]
   * @param {Function} [options.onDifficultyChange]
   * @param {Array} [options.charts]
   * @param {number} [options.currentDifficulty]
   * @param {boolean} [options.hasVideo]
   * @param {boolean} [options.audioReady]
   */
  showReadyToPlay(options = {}) {
    const {
      songTitle = 'Song',
      artist = '',
      onPlay,
      onBrowse,
      onBack,
      onDifficultyChange,
      charts = [],
      currentDifficulty = 0,
      hasVideo = false,
      audioReady = true
    } = options;

    this._state = STATES.READY;
    this._audioReady = audioReady !== false;
    this._title = songTitle || 'Song';
    this._artist = artist || '';
    this._status = this._audioReady ? '' : 'Getting the audio';
    this._charts = charts;
    const index = Number(currentDifficulty);
    this._currentDifficulty =
      Number.isInteger(index) && index >= 0 && index < charts.length ? index : 0;
    this._onPlay = onPlay;
    this._onBrowse = onBrowse;
    this._onBack = onBack;
    this._onDifficultyChange = onDifficultyChange;
    this._hasVideo = hasVideo;
    this._videoStatus = hasVideo ? 'pending' : null;
    this._videoProgress = 0;

    this.render();
    this.bindEvents();
    this.focusPrimaryAction();
  }

  /** Audio finished. Enable Start without rebuilding the chart choices. */
  markAudioReady() {
    if (this._state !== STATES.READY) return;
    this._audioReady = true;
    this._status = '';
    const playBtn = this.shadowRoot.getElementById('play-btn');
    if (playBtn) {
      playBtn.disabled = false;
      playBtn.textContent = startLabel(this._charts[this._currentDifficulty]);
    }
    const statusEl = this.shadowRoot.getElementById('status');
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.classList.add('hidden');
    }
  }

  /**
   * @param {string} status
   * @param {number} [progress]
   */
  updateVideoStatus(status, progress = 0) {
    this._videoStatus = status;
    this._videoProgress = progress;

    let statusText = '';
    let statusClass = 'hidden';

    if (status === 'loading' || status === 'pending') {
      statusText =
        progress > 0
          ? `Background video still converting · ${progress}%`
          : 'Background video still converting';
      statusClass = 'video-note';
    }

    logVideoLoad('overlay.updateVideoStatus', {
      status,
      progress,
      statusText: statusText || videoContextStatusMessage('preloadOverlay'),
      hasShadowRoot: !!this.shadowRoot
    });

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

  hide() {
    this._state = STATES.HIDDEN;
    const overlay = this.shadowRoot.getElementById('overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  /**
   * @param {Function} onRetry
   * @param {Function} onBack
   */
  setErrorHandlers(onRetry, onBack) {
    this._onRetry = onRetry;
    this._onBack = onBack;
  }

  /**
   * @returns {string}
   */
  get state() {
    return this._state;
  }

  /** Selected chart while the ready dialog is up, otherwise null. */
  get chartIndex() {
    return this._state === STATES.READY ? this._currentDifficulty : null;
  }

  /**
   * Swap the ready dialog's actions without redrawing the chart buttons.
   * @param {{ onPlay?: Function, onBrowse?: Function, onBack?: Function, onDifficultyChange?: Function }} handlers
   */
  setReadyHandlers(handlers) {
    if (handlers.onPlay) this._onPlay = handlers.onPlay;
    if (handlers.onBrowse) this._onBrowse = handlers.onBrowse;
    if (handlers.onBack) this._onBack = handlers.onBack;
    if (handlers.onDifficultyChange) this._onDifficultyChange = handlers.onDifficultyChange;
  }
}

customElements.define('loading-overlay', LoadingOverlayElement);

export const LoadingOverlay = createComponentProxy(LoadingOverlayElement);

export default LoadingOverlay;
