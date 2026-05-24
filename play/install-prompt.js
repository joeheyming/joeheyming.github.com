/**
 * Install-prompt for the Play PWA.
 *
 * Shows a small, dismissable "Add to home screen" button on mobile
 * browsers when the page is not already running standalone. On Android
 * Chrome we capture `beforeinstallprompt` and let the user trigger the
 * native install dialog from our own UI. On iOS Safari there's no
 * programmatic install API, so the button opens a tiny how-to overlay
 * pointing at the Share menu instead.
 *
 * Self-contained: this file injects its own button, styles, and modal.
 * Load it once from any page that should advertise installability.
 *
 * Hidden when:
 *   - Already running as a standalone PWA
 *   - Desktop (no touch / no coarse pointer)
 *   - User has previously dismissed the prompt (localStorage)
 *   - Inside an iframe (e.g. the HeymingOS shell)
 */
(function () {
  'use strict';

  if (window.playInstallPromptInitialized) return;
  window.playInstallPromptInitialized = true;

  const STORAGE_KEY = 'play.install-prompt.dismissed.v1';

  if (window.self !== window.top) return;

  const isStandalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) ||
    (window.matchMedia && window.matchMedia('(display-mode: minimal-ui)').matches) ||
    window.navigator.standalone === true;
  if (isStandalone) return;

  // Mobile-only — desktop users already have the address bar to
  // bookmark or pin from. Avoid pestering people who don't have a
  // home screen to add to.
  const isMobile =
    window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  if (!isMobile) return;

  let dismissed = false;
  try {
    dismissed = localStorage.getItem(STORAGE_KEY) === '1';
  } catch (_) {
    // Private mode / Safari quirks — just behave as if not dismissed.
  }
  if (dismissed) return;

  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua) && !window.MSStream;
  const isAndroid = /Android/i.test(ua);

  // beforeinstallprompt only fires on Chromium-family browsers that
  // pass install heuristics. We capture and stash the event so we can
  // call .prompt() in response to a user gesture (browsers refuse to
  // show the dialog otherwise).
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch (_) {}
    if (button && button.parentNode) button.parentNode.removeChild(button);
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
  }

  function showIOSHowTo() {
    if (modal.parentNode) return;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('open'));
  }

  function hideIOSHowTo() {
    modal.classList.remove('open');
    setTimeout(() => {
      if (modal.parentNode) modal.parentNode.removeChild(modal);
    }, 220);
  }

  async function onInstallClick() {
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        deferredPrompt = null;
        if (choice && choice.outcome === 'accepted') {
          dismiss();
        }
      } catch (_) {
        // User-agent rejected the prompt — fall back to instructions.
        if (isIOS) showIOSHowTo();
      }
      return;
    }
    if (isIOS) {
      showIOSHowTo();
      return;
    }
    // Android Chrome but no prompt yet (heuristics not met) — point
    // the user at the menu. Less discoverable but still useful.
    showIOSHowTo();
  }

  // Inject styles. Kept inline so the component is fully self-contained
  // and does not depend on play/style.css being loaded.
  const style = document.createElement('style');
  /* Routes through brand.css custom properties (loaded by every Play
   * page) so a theme swap re-tints the install prompt without touching
   * this module. The previous palette (indigo→pink violet gradient,
   * slate-900 dialog) was a fixed dark theme. */
  style.textContent = `
    .play-install-button {
      position: fixed;
      bottom: max(16px, env(safe-area-inset-bottom));
      left: 50%;
      transform: translateX(-50%);
      z-index: 999998;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 11px 18px 11px 14px;
      background: var(--accent-primary);
      color: var(--text-on-accent);
      border: 1px solid var(--hairline-strong);
      border-radius: 999px;
      font: 600 14px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: var(--shadow-card);
      cursor: pointer;
      animation: play-install-rise 0.4s ease-out;
    }
    .play-install-button:active { transform: translateX(-50%) translateY(1px); }
    .play-install-button .pi-icon { font-size: 18px; }
    .play-install-button .pi-close {
      margin-left: 6px;
      width: 22px;
      height: 22px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.2);
      border: 0;
      border-radius: 999px;
      color: var(--text-on-accent);
      font-size: 14px;
      cursor: pointer;
      padding: 0;
    }
    .play-install-button .pi-close:hover { background: rgba(255, 255, 255, 0.32); }
    @keyframes play-install-rise {
      from { opacity: 0; transform: translateX(-50%) translateY(20px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    .play-install-modal {
      position: fixed;
      inset: 0;
      z-index: 999999;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      background: var(--scrim);
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    .play-install-modal.open { opacity: 1; }
    .play-install-modal-card {
      width: min(440px, 100% - 24px);
      margin: 0 12px max(20px, env(safe-area-inset-bottom));
      padding: 20px 22px 18px;
      background: var(--surface-1);
      color: var(--text-1);
      border: 1px solid var(--hairline-strong);
      border-radius: 18px;
      box-shadow: var(--shadow-modal);
      transform: translateY(20px);
      transition: transform 0.22s ease;
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .play-install-modal.open .play-install-modal-card { transform: translateY(0); }
    .play-install-modal h3 {
      margin: 0 0 10px;
      font-size: 17px;
      color: var(--accent-primary);
    }
    .play-install-modal ol {
      margin: 0;
      padding-left: 22px;
      display: grid;
      gap: 8px;
    }
    .play-install-modal li { color: var(--text-2); }
    .play-install-modal kbd {
      display: inline-block;
      padding: 1px 6px;
      background: var(--surface-2);
      border: 1px solid var(--hairline);
      border-radius: 6px;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-1);
    }
    .play-install-modal-actions {
      margin-top: 16px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .play-install-modal-actions button {
      padding: 8px 14px;
      border-radius: 10px;
      border: 1px solid var(--hairline-strong);
      background: var(--surface-2);
      color: var(--text-1);
      font: 600 13px/1 inherit;
      cursor: pointer;
    }
    .play-install-modal-actions .primary {
      background: var(--accent-primary);
      border-color: transparent;
      color: var(--text-on-accent);
    }
  `;
  document.head.appendChild(style);

  // The persistent button.
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'play-install-button';
  button.setAttribute('aria-label', 'Add Play to your home screen');
  button.innerHTML =
    '<span class="pi-icon" aria-hidden="true">📲</span>' +
    '<span class="pi-text">Add to home screen</span>' +
    '<span class="pi-close" aria-label="Dismiss">×</span>';

  button.addEventListener('click', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('pi-close')) {
      e.stopPropagation();
      dismiss();
      return;
    }
    onInstallClick();
  });

  // The iOS / fallback how-to modal.
  const modal = document.createElement('div');
  modal.className = 'play-install-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'How to add Play to your home screen');

  const iosCopy = `
    <h3>Add Play to your home screen</h3>
    <ol>
      <li>Tap the <strong>Share</strong> button <span aria-hidden="true">⎙</span> at the bottom of Safari.</li>
      <li>Scroll and tap <strong>Add to Home Screen</strong>.</li>
      <li>Tap <strong>Add</strong> in the top-right corner.</li>
    </ol>
  `;

  const androidCopy = `
    <h3>Add Play to your home screen</h3>
    <ol>
      <li>Tap the <strong>menu</strong> <kbd>⋮</kbd> at the top-right of Chrome.</li>
      <li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
      <li>Confirm to add the icon.</li>
    </ol>
  `;

  modal.innerHTML =
    '<div class="play-install-modal-card">' +
    (isIOS ? iosCopy : androidCopy) +
    '<div class="play-install-modal-actions">' +
    '<button type="button" class="dismiss">Don\u2019t show again</button>' +
    '<button type="button" class="primary close">Got it</button>' +
    '</div></div>';

  modal.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (target === modal) {
      hideIOSHowTo();
      return;
    }
    if (target.classList.contains('close')) {
      hideIOSHowTo();
    } else if (target.classList.contains('dismiss')) {
      hideIOSHowTo();
      dismiss();
    }
  });

  function attachButton() {
    document.body.appendChild(button);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachButton);
  } else {
    attachButton();
  }

  // If Chrome has a captured prompt, the button can act on it
  // immediately. If not (iOS, or Chrome before heuristics fire), the
  // button still shows — clicking it falls back to the how-to modal.
})();
