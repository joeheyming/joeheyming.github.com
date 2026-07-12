/**
 * @typedef {import('./catalog.js').CatalogItem} CatalogItem
 * @typedef {import('./inventory.js').ShelfSlot} ShelfSlot
 */

import { prefersTouchUi } from './touch-controls.js';

export function createHud() {
  const hud = /** @type {HTMLElement} */ (document.getElementById('hud'));
  const targetCard = /** @type {HTMLElement} */ (document.getElementById('target-card'));
  const targetTitle = /** @type {HTMLElement} */ (document.getElementById('target-title'));
  const targetTagline = /** @type {HTMLElement} */ (document.getElementById('target-tagline'));
  const targetHint = /** @type {HTMLElement} */ (document.getElementById('target-hint'));
  const mobile = prefersTouchUi();

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
   * @param {{ heldItem: CatalogItem, aimedSlot: ShelfSlot | null, aimedTv: boolean }} opts
   */
  function showHolding({ heldItem, aimedSlot, aimedTv }) {
    targetTitle.textContent = heldItem.name;
    targetTagline.textContent = '';
    if (aimedTv) {
      targetHint.innerHTML = mobile ? 'Tap to play on the TV' : 'Click to play on the TV';
    } else if (aimedSlot) {
      targetHint.innerHTML = mobile
        ? 'Tap to place · Rent to watch'
        : 'Click to place here · <kbd>E</kbd> to rent';
    } else {
      targetHint.innerHTML = mobile
        ? 'Rent to watch · aim at a shelf or the TV'
        : '<kbd>E</kbd> rent · shelf to place · back-wall TV to play';
    }
    targetCard.hidden = false;
    hud.classList.add('has-target', 'is-holding');
  }

  /** Idle tip when looking at the wall TV with empty hands. */
  function showDemoTv() {
    targetTitle.textContent = 'Demo TV';
    targetTagline.textContent = 'Bring a tape over and insert it to open Watch.';
    targetHint.innerHTML = mobile
      ? 'Pick up a case, then tap the TV to play'
      : 'Pick up a case, then click the TV to play';
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

  return {
    setBusy,
    clearTarget,
    showIdleTarget,
    showHolding,
    showDemoTv,
    showStatus
  };
}
