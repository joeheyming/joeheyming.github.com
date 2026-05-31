// Persistent "Share DOOM" button — fixed top-right, always visible regardless
// of the flavor picker / clean-hero / moddb-browser mode the page is in.
// Doom is an emulator with no easy level-end hook (uzdoom is Emscripten-wrapped
// GZDoom; only stdout/stderr cross the JS boundary, and the C code doesn't
// emit clean events), so the share affordance has to be in the page chrome
// rather than tied to gameplay state.
//
// One click: navigator.share if available, clipboard fallback otherwise. URL
// is built via window.buildSharedUrl('doom_chrome') so arrivals land as
// `shared_link_arrival` with share_source=doom_chrome in GA.
(function () {
  'use strict';

  if (window.doomShareButtonInitialized) return;
  window.doomShareButtonInitialized = true;

  if (window.top !== window.self) return;

  const STYLE_TEXT = `
    .doom-share-btn {
      position: fixed;
      top: 12px;
      right: 12px;
      z-index: 9000;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      font-family: var(--font-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
      font-size: 13px;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.92);
      background: rgba(20, 20, 20, 0.55);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 999px;
      cursor: pointer;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      transition: background 0.2s ease, border-color 0.2s ease, transform 0.15s ease;
    }
    .doom-share-btn:hover {
      background: rgba(20, 20, 20, 0.78);
      border-color: rgba(255, 255, 255, 0.35);
    }
    .doom-share-btn:active {
      transform: scale(0.97);
    }
    .doom-share-btn[data-state='copied'] {
      background: rgba(34, 134, 58, 0.85);
      border-color: rgba(34, 134, 58, 1);
    }
    .doom-share-btn[data-state='failed'] {
      background: rgba(180, 35, 35, 0.85);
      border-color: rgba(180, 35, 35, 1);
    }
    @media (max-width: 640px) {
      .doom-share-btn {
        top: 8px;
        right: 8px;
        padding: 5px 10px;
        font-size: 12px;
      }
    }
    /* Hide while the engine is in fullscreen so it doesn't bleed onto gameplay. */
    :fullscreen .doom-share-btn,
    :-webkit-full-screen .doom-share-btn {
      display: none;
    }
  `;

  function buildUrl() {
    if (typeof window.buildSharedUrl === 'function') {
      return window.buildSharedUrl('doom_chrome');
    }
    return window.location.href;
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(input);
    if (!ok) throw new Error('copy failed');
  }

  function flash(btn, state, label, originalLabel) {
    btn.dataset.state = state;
    btn.textContent = label;
    setTimeout(() => {
      delete btn.dataset.state;
      btn.textContent = originalLabel;
    }, 1600);
  }

  async function onClick(btn) {
    const url = buildUrl();
    const originalLabel = btn.textContent;

    if (typeof window.trackEvent === 'function') {
      window.trackEvent('doom_share_click', 'Doom', 'doom_chrome');
    }

    if (navigator.share && window.isSecureContext) {
      try {
        await navigator.share({
          title: 'Play DOOM in your browser',
          text: 'Play classic DOOM right in your browser — no install.',
          url
        });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        // Fall through to clipboard.
      }
    }

    try {
      await copyToClipboard(url);
      flash(btn, 'copied', '✓ Link copied', originalLabel);
    } catch (_) {
      flash(btn, 'failed', '✗ Copy failed', originalLabel);
    }
  }

  function mount() {
    if (document.querySelector('.doom-share-btn')) return;

    const style = document.createElement('style');
    style.id = 'doom-share-button-styles';
    style.textContent = STYLE_TEXT;
    document.head.appendChild(style);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'doom-share-btn';
    btn.setAttribute('aria-label', 'Share DOOM');
    btn.textContent = '🔗 Share';
    btn.addEventListener('click', () => onClick(btn));

    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
