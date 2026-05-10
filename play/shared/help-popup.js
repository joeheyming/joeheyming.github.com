// Help-popup — turns the inline ".instrument-help" panel into a tap-to-open
// "?" floating button + modal on phone-sized viewports.
//
// Why: the inline help is hidden by /play/style.css on phones (the playing
// area should own ~80% of the viewport), which leaves first-time mobile
// players with no way to find the instructions. This script clones the
// existing markup into a centered modal and exposes a small "?" trigger
// near the Instruments pill.
//
// Standalone on purpose: depends on no other shared scripts, so a single
// `<script src="/play/shared/help-popup.js" defer></script>` per page is
// enough. The button is hidden via CSS on viewports where the inline help
// is already visible (desktop / iPad portrait), so adding the script to a
// desktop visit is a no-op visually.
//
// Detection of "is there help on this page?" is a single querySelector
// against `.instrument-help` — pages without it get no button and no
// modal injected.

(function () {
  'use strict';

  if (window.helpPopupInitialized) return;
  window.helpPopupInitialized = true;

  function init() {
    const help = document.querySelector('.instrument-help');
    if (!help) return;

    const titleText = readTitle(help);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'help-popup-button';
    button.setAttribute('aria-label', titleText);
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.textContent = '?';

    const overlay = document.createElement('div');
    overlay.className = 'help-popup-overlay';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'help-popup-title');

    const dialog = document.createElement('div');
    dialog.className = 'help-popup-dialog';

    const header = document.createElement('div');
    header.className = 'help-popup-header';

    const title = document.createElement('h2');
    title.className = 'help-popup-title';
    title.id = 'help-popup-title';
    title.textContent = titleText;
    header.appendChild(title);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'help-popup-close';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '&times;';
    header.appendChild(close);

    dialog.appendChild(header);

    const body = document.createElement('div');
    body.className = 'help-popup-body';
    dialog.appendChild(body);

    overlay.appendChild(dialog);

    function fillBody() {
      // Re-clone on every open so we pick up any live updates the
      // instrument page makes after load — e.g. accordion.js unhides
      // the bellows-help <li> only after DeviceMotion sensor detection.
      body.innerHTML = '';
      Array.from(help.children).forEach(function (child) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'summary' || tag === 'h2') return;
        body.appendChild(child.cloneNode(true));
      });
    }

    function open() {
      fillBody();
      overlay.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      document.body.classList.add('help-popup-open');
      // Move focus into the dialog for keyboard / screen-reader users.
      close.focus();
    }

    function closeFn() {
      overlay.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('help-popup-open');
      button.focus();
    }

    button.addEventListener('click', open);
    close.addEventListener('click', closeFn);
    overlay.addEventListener('click', function (e) {
      // Backdrop dismiss — only when the click target is the overlay
      // itself, not a child of the dialog.
      if (e.target === overlay) closeFn();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !overlay.hidden) closeFn();
    });

    document.body.appendChild(button);
    document.body.appendChild(overlay);
  }

  function readTitle(help) {
    // Pages use either <details><summary>How to play</summary> or
    // <section><h2>How to play</h2>; the metronome page uses
    // "How to use". Mirror whatever the page already says.
    const summary = help.querySelector(':scope > summary');
    if (summary && summary.textContent.trim()) return summary.textContent.trim();
    const h2 = help.querySelector(':scope > h2');
    if (h2 && h2.textContent.trim()) return h2.textContent.trim();
    return 'How to play';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
