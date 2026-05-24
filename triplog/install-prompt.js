/**
 * Install prompt for the Trip Log PWA.
 *
 * Shows a small, dismissable "Add to home screen" button on mobile
 * browsers when the page is not already running standalone. On Android
 * Chrome we capture `beforeinstallprompt` and let the user trigger the
 * native install dialog from our own UI. On iOS Safari there's no
 * programmatic install API, so the button opens a how-to overlay
 * pointing at the Share menu instead.
 *
 * Trip Log especially wants the user to install: when the page is just
 * a tab Chrome on Android freezes it after the screen locks and GPS
 * fixes stop coming in. An installed PWA lives in its own task and
 * survives backgrounding much longer (combined with the silent-audio
 * + persistent-notification keepalive in this app).
 *
 * Self-contained: this file injects its own button, styles, and modal.
 *
 * Hidden when:
 *   - Already running as a standalone PWA
 *   - Desktop (no touch / no coarse pointer)
 *   - User has previously dismissed the prompt (localStorage)
 *   - Inside an iframe (e.g. the HeymingOS shell)
 */
(function () {
  'use strict';

  if (window.triplogInstallPromptInitialized) return;
  window.triplogInstallPromptInitialized = true;

  const STORAGE_KEY = 'triplog.install-prompt.dismissed.v1';

  if (window.self !== window.top) return;

  const isStandalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) ||
    (window.matchMedia && window.matchMedia('(display-mode: minimal-ui)').matches) ||
    window.navigator.standalone === true;
  if (isStandalone) return;

  // Mobile-only — desktop users have the address bar to pin/bookmark
  // from. Trip Log on desktop is a curiosity at best; the install
  // pitch (better background tracking) only makes sense on a phone.
  const isMobile =
    window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  if (!isMobile) return;

  let dismissed = false;
  try {
    dismissed = localStorage.getItem(STORAGE_KEY) === '1';
  } catch (_) {
    /* private mode / Safari quirks — treat as not dismissed */
  }
  if (dismissed) return;

  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua) && !window.MSStream;

  // `beforeinstallprompt` only fires on Chromium-family browsers that
  // pass install heuristics. We stash the event so we can call
  // `.prompt()` later in response to a user gesture (browsers refuse
  // to show the dialog otherwise).
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch (_) {
      /* best-effort */
    }
    if (button && button.parentNode) button.parentNode.removeChild(button);
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
  }

  function showHowTo() {
    if (modal.parentNode) return;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('open'));
  }

  function hideHowTo() {
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
        if (isIOS) showHowTo();
      }
      return;
    }
    showHowTo();
  }

  const style = document.createElement('style');
  // Routes through brand.css custom properties so a theme swap re-tints
  // the install prompt without touching this module.
  style.textContent = `
    .triplog-install-button {
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
      animation: triplog-install-rise 0.4s ease-out;
    }
    .triplog-install-button:active { transform: translateX(-50%) translateY(1px); }
    .triplog-install-button .ti-icon { font-size: 18px; }
    .triplog-install-button .ti-close {
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
    .triplog-install-button .ti-close:hover { background: rgba(255, 255, 255, 0.32); }
    @keyframes triplog-install-rise {
      from { opacity: 0; transform: translateX(-50%) translateY(20px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    .triplog-install-modal {
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
    .triplog-install-modal.open { opacity: 1; }
    .triplog-install-modal-card {
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
    .triplog-install-modal.open .triplog-install-modal-card { transform: translateY(0); }
    .triplog-install-modal h3 {
      margin: 0 0 10px;
      font-size: 17px;
      color: var(--accent-primary);
    }
    .triplog-install-modal p { margin: 0 0 10px; color: var(--text-2); }
    .triplog-install-modal ol {
      margin: 0;
      padding-left: 22px;
      display: grid;
      gap: 8px;
    }
    .triplog-install-modal li { color: var(--text-2); }
    .triplog-install-modal kbd {
      display: inline-block;
      padding: 1px 6px;
      background: var(--surface-2);
      border: 1px solid var(--hairline);
      border-radius: 6px;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-1);
    }
    .triplog-install-modal-actions {
      margin-top: 16px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .triplog-install-modal-actions button {
      padding: 8px 14px;
      border-radius: 10px;
      border: 1px solid var(--hairline-strong);
      background: var(--surface-2);
      color: var(--text-1);
      font: 600 13px/1 inherit;
      cursor: pointer;
    }
    .triplog-install-modal-actions .primary {
      background: var(--accent-primary);
      border-color: transparent;
      color: var(--text-on-accent);
    }
  `;
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'triplog-install-button';
  button.setAttribute('aria-label', 'Add Trip Log to your home screen');
  button.innerHTML =
    '<span class="ti-icon" aria-hidden="true">📲</span>' +
    '<span class="ti-text">Install Trip Log</span>' +
    '<span class="ti-close" aria-label="Dismiss">×</span>';

  button.addEventListener('click', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('ti-close')) {
      e.stopPropagation();
      dismiss();
      return;
    }
    onInstallClick();
  });

  const modal = document.createElement('div');
  modal.className = 'triplog-install-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'How to add Trip Log to your home screen');

  const pitch =
    '<p>Installed, Trip Log keeps GPS recording running longer with your screen off — phones throttle plain browser tabs much harder.</p>';

  const iosCopy = `
    <h3>Add Trip Log to your home screen</h3>
    ${pitch}
    <ol>
      <li>Tap the <strong>Share</strong> button <span aria-hidden="true">⎙</span> at the bottom of Safari.</li>
      <li>Scroll and tap <strong>Add to Home Screen</strong>.</li>
      <li>Tap <strong>Add</strong> in the top-right corner.</li>
    </ol>
  `;

  const androidCopy = `
    <h3>Add Trip Log to your home screen</h3>
    ${pitch}
    <ol>
      <li>Tap the <strong>menu</strong> <kbd>⋮</kbd> at the top-right of Chrome.</li>
      <li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
      <li>Confirm to add the icon.</li>
    </ol>
  `;

  modal.innerHTML =
    '<div class="triplog-install-modal-card">' +
    (isIOS ? iosCopy : androidCopy) +
    '<div class="triplog-install-modal-actions">' +
    '<button type="button" class="dismiss">Don\u2019t show again</button>' +
    '<button type="button" class="primary close">Got it</button>' +
    '</div></div>';

  modal.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (target === modal) {
      hideHowTo();
      return;
    }
    if (target.classList.contains('close')) {
      hideHowTo();
    } else if (target.classList.contains('dismiss')) {
      hideHowTo();
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
})();
