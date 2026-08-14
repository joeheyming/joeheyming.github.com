/**
 * @typedef {import('./catalog.js').CatalogItem} CatalogItem
 * @typedef {import('./inventory.js').ShelfSlot} ShelfSlot
 */

import { prefersTouchUi } from './touch-controls.js';

/**
 * @param {{
 *   ambience?: { toggleMute: () => boolean, isMuted: () => boolean }
 * }} [opts]
 */
export function createHud(opts = {}) {
  const hud = /** @type {HTMLElement} */ (document.getElementById('hud'));
  const targetCard = /** @type {HTMLElement} */ (document.getElementById('target-card'));
  const targetTitle = /** @type {HTMLElement} */ (document.getElementById('target-title'));
  const targetTagline = /** @type {HTMLElement} */ (document.getElementById('target-tagline'));
  const targetHint = /** @type {HTMLElement} */ (document.getElementById('target-hint'));
  const muteBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('mute-btn'));
  const mobile = prefersTouchUi();

  if (muteBtn && opts.ambience) {
    muteBtn.hidden = false;
    const syncMute = () => {
      const muted = opts.ambience?.isMuted() ?? false;
      muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
      muteBtn.textContent = muted ? 'Unmute' : 'Mute';
      muteBtn.title = muted ? 'Unmute store ambience' : 'Mute store ambience';
    };
    syncMute();
    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.ambience?.toggleMute();
      syncMute();
    });
  }

  /** @param {boolean} busy */
  function setBusy(busy) {
    hud.classList.toggle('is-busy', busy);
  }

  function clearTarget() {
    targetCard.hidden = true;
    hud.classList.remove('has-target', 'is-holding');
  }

  /** @param {CatalogItem} item */
  function showIdleTarget(item) {
    const kind = item.kind === 'show' ? 'TV · ' : '';
    targetTitle.textContent = item.name;
    targetTagline.textContent = `${kind}${item.tagline || ''}`.trim();
    targetHint.innerHTML = mobile ? 'Tap to pick up' : 'Click or press <kbd>E</kbd> to pick up';
    targetCard.hidden = false;
    hud.classList.add('has-target');
    hud.classList.remove('is-holding');
  }

  /**
   * @param {{
   *   heldItem: CatalogItem,
   *   aimedSlot: ShelfSlot | null,
   *   aimedTv: boolean,
   *   flipped?: boolean
   * }} opts
   */
  function showHolding({ heldItem, aimedSlot, aimedTv, flipped = false }) {
    targetTitle.textContent = heldItem.name;
    targetTagline.textContent = flipped ? heldItem.tagline || 'Back of the box' : '';
    if (aimedTv) {
      targetHint.innerHTML = mobile ? 'Tap to play on the TV' : 'Click to insert in the TV';
    } else if (aimedSlot) {
      targetHint.innerHTML = mobile
        ? 'Tap to place · Rent to watch'
        : 'Click to place · <kbd>E</kbd> rent · <kbd>F</kbd> flip';
    } else {
      targetHint.innerHTML = mobile
        ? 'Rent to watch · aim at a shelf or the TV'
        : `<kbd>E</kbd> rent · <kbd>F</kbd> ${flipped ? 'cover' : 'flip'} · TV to preview`;
    }
    targetCard.hidden = false;
    hud.classList.add('has-target', 'is-holding');
  }

  /**
   * Idle tip when looking at the wall TV with empty hands.
   * @param {CatalogItem | null} [featured]
   */
  function showDemoTv(featured = null) {
    if (featured) {
      targetTitle.textContent = featured.name;
      targetTagline.textContent = `Featured tonight · ${featured.tagline || 'Demo TV'}`;
      targetHint.innerHTML = mobile
        ? 'Pick up a case, then tap the TV to preview'
        : 'Pick up a case, then click the TV to preview';
    } else {
      targetTitle.textContent = 'Demo TV';
      targetTagline.textContent = 'Bring a tape over and insert it to preview.';
      targetHint.innerHTML = mobile
        ? 'Pick up a case, then tap the TV to preview'
        : 'Pick up a case, then click the TV to preview';
    }
    targetCard.hidden = false;
    hud.classList.add('has-target');
    hud.classList.remove('is-holding');
  }

  /** @param {CatalogItem} item */
  function showRentPrompt(item) {
    targetTitle.textContent = item.name;
    targetTagline.textContent = 'Ready on the demo TV';
    targetHint.innerHTML = mobile
      ? 'Rent to watch in full'
      : '<kbd>E</kbd> or click the TV to rent · opens Watch';
    targetCard.hidden = false;
    hud.classList.add('has-target');
    hud.classList.remove('is-holding');
  }

  /**
   * Transient status during grab / place / insert animations.
   * @param {string} title
   * @param {string} [tagline]
   * @param {string} [hint]
   */
  function showStatus(title, tagline = '', hint = '') {
    targetTitle.textContent = title;
    targetTagline.textContent = tagline;
    targetHint.textContent = hint;
    targetCard.hidden = false;
    hud.classList.add('has-target');
  }

  /** @param {string} text */
  function showChallenge(text) {
    const el = /** @type {HTMLElement | null} */ (document.getElementById('challenge-banner'));
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
  }

  function clearChallenge() {
    const el = /** @type {HTMLElement | null} */ (document.getElementById('challenge-banner'));
    if (!el) return;
    el.hidden = true;
  }

  return {
    setBusy,
    clearTarget,
    showIdleTarget,
    showHolding,
    showDemoTv,
    showRentPrompt,
    showStatus,
    showChallenge,
    clearChallenge
  };
}
