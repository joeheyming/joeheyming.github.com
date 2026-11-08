// Which StepMania arrow map a browser gamepad should use.
//
// Kept separate from gamepad.js so the choice can be tested without starting
// the page's polling loop.

export const STANDARD_DANCE_BUTTONS = {
  left: 14,
  right: 15,
  up: 12,
  down: 13,
  leftAlt: 2,
  rightAlt: 1,
  upAlt: 3,
  downAlt: 0
};

/**
 * Pick a button map from the id the browser reports.
 * A DualShock 4 in Chrome is `mapping: "standard"` and is not named "playstation",
 * so a name-only check left it on the dance-pad indices (left on button 15).
 * @param {{ id?: string, mapping?: string } | null | undefined} gamepad
 * @returns {'dancePad'|'standard'|'ps2'|'usbGamePad'|'usbGamePad2'}
 */
export function mappingNameForGamepad(gamepad) {
  const name = String((gamepad && gamepad.id) || '').toLowerCase();
  if (name.includes('dance') || name.includes('step')) return 'dancePad';
  if ((gamepad && gamepad.mapping === 'standard') || name.includes('standard gamepad')) {
    return 'standard';
  }
  if (name.includes('ps2') || name.includes('playstation')) return 'ps2';
  if (name.includes('0e8f') && name.includes('3013')) return 'usbGamePad';
  if (name.includes('0079') && name.includes('0011')) return 'usbGamePad2';
  return 'dancePad';
}

/** @param {Element} el */
function shown(el) {
  /** @type {Element | null} */
  let node = el;
  while (node && node.nodeType === 1) {
    if (/** @type {HTMLElement} */ (node).hidden) return false;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (node.parentElement) {
      node = node.parentElement;
      continue;
    }
    const root = node.getRootNode ? node.getRootNode() : null;
    node =
      root && /** @type {ShadowRoot} */ (root).host ? /** @type {ShadowRoot} */ (root).host : null;
  }
  return true;
}

const DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"], dialog[open]';

/**
 * A chart takes the pad only when one is on screen with nothing over it.
 * The song card (<loading-overlay>) opens before #sm-home comes back, so
 * the home check alone handed Start, the charts, and Pick a different song
 * to the lanes behind it.
 * @param {Document} doc
 * @returns {boolean}
 */
export function chartOwnsPad(doc) {
  const home = doc.getElementById('sm-home');
  if (!home || !home.hidden) return false;
  const overlay = /** @type {(HTMLElement & { state?: string }) | null} */ (
    doc.getElementById('loading-overlay')
  );
  if (overlay && overlay.state && overlay.state !== 'hidden') return false;
  const roots = [doc];
  const hosts = doc.querySelectorAll(
    'loading-overlay, zenius-browser, sm-settings-sheet, game-over-modal, difficulty-selector'
  );
  for (const host of hosts) {
    if (host.shadowRoot) roots.push(host.shadowRoot);
  }
  for (const root of roots) {
    for (const dialog of root.querySelectorAll(DIALOG_SELECTOR)) {
      if (shown(dialog)) return false;
    }
  }
  return true;
}
