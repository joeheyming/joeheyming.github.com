/**
 * Shared keyboard gate for Pac-Man and Pac-Infinite.
 *
 * The maze keeps arrows, Space, and Enter while focus is on the page
 * background. A focused button, link, or other control keeps those keys
 * so Tab / arrow focus movement and Space / Enter activation still work.
 */

/**
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
export function uiOwnsKey(event) {
  const remote = typeof window !== 'undefined' ? window.heymingRemote : undefined;
  if (remote && typeof remote.arrowsMoveFocus === 'function' && remote.arrowsMoveFocus(event)) {
    return true;
  }
  const code = event.code || '';
  const key = event.key || '';
  if (code !== 'Space' && code !== 'Enter' && key !== ' ' && key !== 'Enter') return false;
  const path = typeof event.composedPath === 'function' ? event.composedPath() : null;
  const raw = path && path.length ? path[0] : event.target;
  const el = raw && raw.nodeType === 1 ? raw : null;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest('button, a[href], input, textarea, select, summary, [role="button"]');
}

/**
 * @param {Element | null | undefined} el
 */
export function focusControl(el) {
  if (!el || typeof el.focus !== 'function') return;
  try {
    el.focus({ preventScroll: true, focusVisible: true });
  } catch (_) {
    try {
      el.focus({ preventScroll: true });
    } catch (_err) {
      try {
        el.focus();
      } catch (_err2) {
        /* element cannot take focus */
      }
    }
  }
}

/**
 * Click the first visible menu button in `ids`.
 * @param {string[]} ids
 * @returns {boolean}
 */
export function clickMenuButton(ids) {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el || typeof el.closest !== 'function') continue;
    if (el.closest('.hidden, [hidden]')) continue;
    el.click();
    return true;
  }
  return false;
}
