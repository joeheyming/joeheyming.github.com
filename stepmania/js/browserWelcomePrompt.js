// First-visit overlay encouraging Zenius song browser (decoupled from MainPageController)

const STORAGE_KEY = 'stepmania_browser_seen';

/**
 * After delay, show welcome overlay if user has not dismissed it before.
 * @param {{ delayMs?: number }} [options]
 */
export function scheduleFirstVisitBrowserPrompt(options = {}) {
  const delayMs = options.delayMs ?? 500;
  if (localStorage.getItem(STORAGE_KEY)) return;
  setTimeout(() => {
    showBrowserWelcomePrompt();
  }, delayMs);
}

/**
 * Modal prompt: browse songs or dismiss. Persists STORAGE_KEY on close.
 */
export function showBrowserWelcomePrompt() {
  const zeniusBrowser = document.querySelector('zenius-browser');
  if (zeniusBrowser && zeniusBrowser.classList.contains('modal-open')) {
    return;
  }

  const promptOverlay = document.createElement('div');
  promptOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--scrim);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      animation: fadeIn 0.3s ease-out;
    `;

  promptOverlay.innerHTML = `
      <style>
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .browser-prompt {
          background: var(--surface-0);
          border: 1px solid var(--hairline-strong);
          border-radius: var(--radius-lg);
          padding: 2rem;
          max-width: 90%;
          width: 500px;
          box-shadow: var(--shadow-modal);
          animation: slideUp 0.3s ease-out;
          text-align: center;
        }
        .browser-prompt h3 {
          color: var(--text-1);
          font-family: var(--font-display);
          font-size: 1.5rem;
          margin: 0 0 1rem 0;
        }
        .browser-prompt p {
          color: var(--text-2);
          margin: 0 0 1.5rem 0;
          line-height: 1.6;
        }
        .browser-prompt-buttons {
          display: flex;
          gap: 1rem;
          justify-content: center;
        }
        .browser-prompt-btn {
          padding: 0.75rem 1.5rem;
          border-radius: var(--radius);
          border: 1px solid transparent;
          font-weight: 600;
          cursor: pointer;
          font-size: 1rem;
          transition: all 0.2s;
        }
        .browser-prompt-btn-primary {
          background: var(--accent-primary-bg);
          color: var(--text-on-accent);
          border-color: var(--accent-primary-bg);
        }
        .browser-prompt-btn-primary:hover {
          background: var(--accent-primary-bg-hover);
          border-color: var(--accent-primary-bg-hover);
        }
        .browser-prompt-btn-secondary {
          background: var(--surface-1);
          color: var(--text-1);
          border-color: var(--hairline-strong);
        }
        .browser-prompt-btn-secondary:hover {
          background: var(--surface-2);
        }
      </style>
      <div class="browser-prompt">
        <h3>🎵 Welcome to StepMania!</h3>
        <p>
          Browse thousands of songs from Zenius-I-Vanisher! 
          Click the "Songs" button to explore and find your favorite tracks.
        </p>
        <div class="browser-prompt-buttons">
          <button class="browser-prompt-btn browser-prompt-btn-primary" id="open-browser-now">
            🎵 Browse Songs
          </button>
          <button class="browser-prompt-btn browser-prompt-btn-secondary" id="dismiss-prompt">
            Maybe Later
          </button>
        </div>
      </div>
    `;

  document.body.appendChild(promptOverlay);

  const openBtn = promptOverlay.querySelector('#open-browser-now');
  const dismissBtn = promptOverlay.querySelector('#dismiss-prompt');

  const closePrompt = () => {
    promptOverlay.remove();
    localStorage.setItem(STORAGE_KEY, 'true');
  };

  openBtn.addEventListener('click', () => {
    closePrompt();
    if (typeof window.trackEvent === 'function') {
      window.trackEvent('song_browser_open', 'StepMania', 'Welcome Prompt');
    }
    const browser = document.querySelector('zenius-browser');
    if (browser && typeof browser.showBrowser === 'function') {
      browser.showBrowser();
    }
  });

  dismissBtn.addEventListener('click', closePrompt);

  promptOverlay.addEventListener('click', (e) => {
    if (e.target === promptOverlay) {
      closePrompt();
    }
  });
}
