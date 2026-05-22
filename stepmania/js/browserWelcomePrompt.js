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
      background: rgba(0, 0, 0, 0.7);
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
          background: #1f2937;
          border: 2px solid #8b5cf6;
          border-radius: 0.75rem;
          padding: 2rem;
          max-width: 90%;
          width: 500px;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
          animation: slideUp 0.3s ease-out;
          text-align: center;
        }
        .browser-prompt h3 {
          color: white;
          font-size: 1.5rem;
          margin: 0 0 1rem 0;
        }
        .browser-prompt p {
          color: #d1d5db;
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
          border-radius: 0.5rem;
          border: none;
          font-weight: 600;
          cursor: pointer;
          font-size: 1rem;
          transition: all 0.2s;
        }
        .browser-prompt-btn-primary {
          background: #6d28d9;
          color: white;
        }
        .browser-prompt-btn-primary:hover {
          background: #5b21b6;
        }
        .browser-prompt-btn-secondary {
          background: #4b5563;
          color: white;
        }
        .browser-prompt-btn-secondary:hover {
          background: #374151;
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
