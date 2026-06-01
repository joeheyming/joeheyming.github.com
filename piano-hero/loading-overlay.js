// <piano-hero-loading-overlay> — state-machine overlay that mirrors
// stepmania's loading-overlay. States:
//   hidden  — no overlay visible
//   loading — spinner + label, optional progress bar (0..1)
//   error   — error text + Retry button (which fires `retry` event)
//   ready   — momentary "Loaded" flash before hiding (auto-clears in 600ms)

const STATES = {
  HIDDEN: 'hidden',
  LOADING: 'loading',
  ERROR: 'error',
  READY: 'ready'
};

class LoadingOverlayElement extends HTMLElement {
  /** @type {LoadingOverlayElement | null} */
  static _instance = null;

  static get() {
    if (!LoadingOverlayElement._instance) {
      LoadingOverlayElement._instance = document.querySelector('piano-hero-loading-overlay');
    }
    return LoadingOverlayElement._instance;
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._state = STATES.HIDDEN;
    this._progress = 0;
    this._title = '';
    this._message = '';
    this._readyTimer = 0;
  }

  connectedCallback() {
    this.render();
    this._update();
  }

  setState(state, opts = {}) {
    this._state = STATES[state.toUpperCase()] || state;
    if (typeof opts.title === 'string') this._title = opts.title;
    if (typeof opts.message === 'string') this._message = opts.message;
    if (typeof opts.progress === 'number') this._progress = opts.progress;
    if (this._readyTimer) {
      clearTimeout(this._readyTimer);
      this._readyTimer = 0;
    }
    if (this._state === STATES.READY) {
      this._readyTimer = setTimeout(() => this.setState('hidden'), 600);
    }
    this._update();
  }

  setProgress(p) {
    this._progress = Math.max(0, Math.min(1, Number(p) || 0));
    this._update();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .scrim {
          position: fixed; inset: 0;
          z-index: 999985;
          display: none;
          align-items: center; justify-content: center;
          background: rgba(15, 23, 42, 0.55);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          font-family: system-ui, -apple-system, "Inter", sans-serif;
        }
        :host([data-state="loading"]) .scrim,
        :host([data-state="error"]) .scrim,
        :host([data-state="ready"]) .scrim { display: flex; }

        .card {
          background: #0f172a;
          color: #e2e8f0;
          border-radius: 14px;
          border: 1px solid #1e293b;
          padding: 24px 32px;
          min-width: 280px; max-width: 420px;
          text-align: center;
          box-shadow: 0 24px 60px -10px rgba(0,0,0,0.6);
        }
        .icon { font-size: 32px; line-height: 1; margin-bottom: 10px; }
        .title { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
        .msg { font-size: 13px; color: #94a3b8; margin-bottom: 12px; }
        .bar {
          height: 4px; background: #1e293b; border-radius: 2px;
          overflow: hidden;
        }
        .bar > div {
          height: 100%; width: 0%;
          background: linear-gradient(90deg, #6366f1, #8b5cf6);
          transition: width 200ms ease;
        }
        .spinner {
          width: 22px; height: 22px;
          border-radius: 50%;
          border: 3px solid #334155;
          border-top-color: #6366f1;
          margin: 0 auto 12px;
          animation: spin 700ms linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        button {
          margin-top: 14px;
          background: #6366f1; color: white; border: none;
          padding: 8px 18px; border-radius: 8px; cursor: pointer;
          font: inherit; font-weight: 600;
        }
        button:hover { background: #4f46e5; }

        :host([data-state="ready"]) .card {
          animation: pulse 600ms ease;
        }
        @keyframes pulse {
          0% { transform: scale(1); }
          40% { transform: scale(1.05); }
          100% { transform: scale(1); }
        }
        :host([data-state="error"]) .icon { color: #f87171; }
      </style>
      <div class="scrim" part="scrim">
        <div class="card" role="status" aria-live="polite">
          <div id="spinner" class="spinner"></div>
          <div id="icon" class="icon" hidden></div>
          <div id="title" class="title"></div>
          <div id="msg" class="msg"></div>
          <div id="bar" class="bar" hidden><div></div></div>
          <button id="retry" type="button" hidden>Try again</button>
        </div>
      </div>
    `;
    this.shadowRoot.getElementById('retry').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('retry', { bubbles: true }));
    });
  }

  _update() {
    if (!this.shadowRoot.firstChild) return;
    const root = this.shadowRoot;
    this.dataset.state = this._state;

    const spinner = root.getElementById('spinner');
    const icon = root.getElementById('icon');
    const titleEl = root.getElementById('title');
    const msgEl = root.getElementById('msg');
    const bar = root.getElementById('bar');
    const retry = root.getElementById('retry');

    titleEl.textContent = this._title;
    msgEl.textContent = this._message;
    msgEl.hidden = !this._message;

    spinner.hidden = this._state !== STATES.LOADING;
    bar.hidden = this._state !== STATES.LOADING || this._progress <= 0;
    bar.firstElementChild.style.width = `${Math.round(this._progress * 100)}%`;

    if (this._state === STATES.ERROR) {
      icon.hidden = false;
      icon.textContent = '⚠️';
      retry.hidden = false;
    } else if (this._state === STATES.READY) {
      icon.hidden = false;
      icon.textContent = '✓';
      retry.hidden = true;
    } else {
      icon.hidden = true;
      retry.hidden = true;
    }
  }
}

customElements.define('piano-hero-loading-overlay', LoadingOverlayElement);

export { LoadingOverlayElement };
