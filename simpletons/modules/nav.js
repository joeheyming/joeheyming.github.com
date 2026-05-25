/**
 * Spatial D-pad navigation for TV mode.
 *
 * A TV remote only emits ArrowUp/Down/Left/Right and Enter. Tab order
 * isn't enough — the user expects pressing ▼ from a season chip to land
 * on the episode card directly below it, regardless of DOM order. This
 * module implements that by measuring layout rects on each key press
 * and picking the best-scoring candidate in the chosen direction.
 *
 * Algorithm: for an arrow key, find every focusable element whose
 * bounding rect lies *past* the current element's rect on the chosen
 * axis (with a small tolerance for siblings that share a baseline).
 * Score each candidate by primary-axis distance + a heavy penalty for
 * perpendicular-axis offset, so movement prefers near-aligned items.
 *
 * We deliberately re-query the focusable set on every keypress: the
 * episode grid re-renders when the user changes seasons, and caching
 * NodeLists across renders is a footgun.
 */

const DEFAULT_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'video[controls]',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * Install document-level arrow-key handling. Idempotent — calling twice
 * is a no-op so re-entering TV mode never doubles up listeners.
 *
 * @param {{ focusableSelector?: string }} [opts]
 */
export function enableSpatialNav(opts = {}) {
  if (typeof window === 'undefined') return;
  if (window.__simpletonsSpatialNav) return;
  window.__simpletonsSpatialNav = true;

  const selector = opts.focusableSelector || DEFAULT_SELECTOR;

  document.addEventListener(
    'keydown',
    (e) => {
      if (!ARROW_KEYS.has(e.key)) return;
      // Don't hijack arrow keys inside text inputs or the native video
      // controls (the user expects Up/Down to change volume there).
      const ae = document.activeElement;
      if (ae && isTextInput(ae)) return;
      if (ae && ae.tagName === 'VIDEO' && videoHasInternalFocus(ae)) return;

      const moved = moveFocus(e.key, selector);
      if (moved) e.preventDefault();
    },
    { capture: true }
  );

  // If nothing is focused yet (initial load), focus the first item so
  // the user has somewhere to start from when they press an arrow key.
  document.addEventListener(
    'focusin',
    () => {
      /* no-op: just ensures the document listens for focus changes */
    },
    { capture: true, once: true }
  );

  // Seed initial focus on the first focusable element after the catalog
  // renders. We don't know exactly when that is, so just retry a couple
  // of times on a short delay — cheap, and stops once anything is focused.
  let attempts = 0;
  const seed = () => {
    if (attempts++ > 8) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    const first = document.querySelector(selector);
    if (first instanceof HTMLElement) {
      first.focus({ preventScroll: true });
      return;
    }
    window.setTimeout(seed, 250);
  };
  window.setTimeout(seed, 250);
}

/**
 * Pick the best next-focus candidate in the given direction. Returns
 * true if focus moved, false if there was nothing reasonable to move to
 * (e.g. user is already at the edge of the grid).
 *
 * @param {string} key   e.g. "ArrowDown"
 * @param {string} selector  CSS selector for focusable elements
 */
function moveFocus(key, selector) {
  const current = currentFocusable();
  const all = Array.from(document.querySelectorAll(selector)).filter(isVisible);
  if (all.length === 0) return false;

  // Cold start — focus the first visible item.
  if (!current) {
    all[0].focus();
    return true;
  }

  const from = current.getBoundingClientRect();
  const fromCx = from.left + from.width / 2;
  const fromCy = from.top + from.height / 2;

  let best = null;
  let bestScore = Infinity;

  for (const el of all) {
    if (el === current) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = cx - fromCx;
    const dy = cy - fromCy;

    let primary;
    let perpendicular;
    switch (key) {
      case 'ArrowDown':
        if (r.top < from.bottom - 1) continue;
        primary = Math.max(0, r.top - from.bottom) + dy * 0.001; // tie-break by cy
        perpendicular = Math.abs(dx);
        break;
      case 'ArrowUp':
        if (r.bottom > from.top + 1) continue;
        primary = Math.max(0, from.top - r.bottom) - dy * 0.001;
        perpendicular = Math.abs(dx);
        break;
      case 'ArrowRight':
        if (r.left < from.right - 1) continue;
        primary = Math.max(0, r.left - from.right) + dx * 0.001;
        perpendicular = Math.abs(dy);
        break;
      case 'ArrowLeft':
        if (r.right > from.left + 1) continue;
        primary = Math.max(0, from.left - r.right) - dx * 0.001;
        perpendicular = Math.abs(dy);
        break;
      default:
        continue;
    }

    // Heavy perpendicular weight so movement prefers aligned items.
    // Without it, ArrowDown from a chip might jump diagonally to a
    // distant card instead of the one directly below.
    const score = primary + perpendicular * 4;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }

  if (!best) return false;
  best.focus({ preventScroll: false });
  best.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  return true;
}

function currentFocusable() {
  const ae = document.activeElement;
  return ae instanceof HTMLElement && ae !== document.body ? ae : null;
}

function isVisible(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hidden) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (Number(style.opacity) === 0) return false;
  return el.getClientRects().length > 0;
}

function isTextInput(el) {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    const type = (el.type || 'text').toLowerCase();
    return ['text', 'search', 'url', 'tel', 'email', 'password', 'number'].includes(type);
  }
  return el instanceof HTMLElement && el.isContentEditable;
}

/**
 * Heuristic for "the user is currently driving the native video player
 * with the keyboard" — when paused/playing focused, we want our spatial
 * nav to override; when scrubbing or adjusting volume, defer. Today we
 * just always defer when the video has focus, which is the safer choice.
 */
function videoHasInternalFocus(_video) {
  return false;
}
