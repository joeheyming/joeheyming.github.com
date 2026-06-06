/**
 * Roving-tabindex grid navigation, à la WAI-ARIA Authoring Practices.
 *
 * Why: on a TV with a remote, the user only has D-pad arrows + select.
 * Tabbing through 50+ show cards is impossible. The accessible pattern
 * is "the grid is one tabstop; arrow keys move a single tabindex=0
 * cursor among the children."
 *
 * Why use it on desktop too: the same logic helps keyboard users who
 * already exist today — pressing Tab lands you in the grid once and
 * lets you arrow-key from there, instead of tabbing through every
 * card. So we don't gate this behind `isTvMode`; it's always-on, but
 * the only-on-TV CSS is what makes the focus ring visible at distance.
 *
 * Layout-aware up/down: rather than asking the caller "how many
 * columns?", we group children by their `offsetTop` at keypress time,
 * so the helper works for any responsive grid (`auto-fill,
 * minmax(220px, 1fr)`) including ones that reflow after a resize.
 *
 * Public API is small on purpose:
 *
 *   const ctrl = applyRovingTabindex(gridEl, { selector: '.tv-show-card' });
 *   ctrl.refresh();          // call after replacing children
 *   ctrl.focusFirst();       // place initial focus
 *   ctrl.dispose();          // remove listeners
 *
 * The grid's own click handlers stay unchanged — this helper only
 * touches `tabindex` and listens for keydown/focusin.
 */

/* eslint-env browser */

/**
 * @typedef {Object} RovingOptions
 * @property {string} [selector]
 *   CSS selector matched against direct children. Defaults to every
 *   element child (`:scope > *`).
 * @property {boolean} [wrap]
 *   Whether arrow-left at column 0 wraps to the previous row's last
 *   item. Defaults to `false` (clamping at the row edge feels more
 *   predictable on a TV remote).
 */

/**
 * @typedef {Object} RovingHandle
 * @property {() => void} refresh
 *   Re-scan children. Call after replacing the grid's contents.
 * @property {() => void} focusFirst
 *   Move focus to the current cursor (first item if no cursor yet).
 *   Useful for "TV-mode initial focus" on view mount.
 * @property {() => void} dispose
 *   Remove every listener and revert tabindex on remaining children.
 */

const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

/**
 * @param {HTMLElement} grid
 * @param {RovingOptions} [options]
 * @returns {RovingHandle}
 */
export function applyRovingTabindex(grid, options = {}) {
  const selector = options.selector || ':scope > *';
  const wrap = options.wrap === true;

  /** @type {HTMLElement[]} */
  let items = [];
  /** Index of the focused / focusable item — the "cursor". */
  let cursor = 0;

  /**
   * Read the current set of matching children. Stores them as a flat
   * array; row/column structure is computed lazily at keypress time
   * via `offsetTop` so reflows are picked up automatically.
   */
  const scan = () => {
    items = /** @type {HTMLElement[]} */ (Array.from(grid.querySelectorAll(selector)));
    if (cursor >= items.length) cursor = Math.max(0, items.length - 1);
    items.forEach((el, i) => {
      el.tabIndex = i === cursor ? 0 : -1;
    });
  };

  /**
   * Group items into rows by offsetTop. Two items belong to the same
   * row if they have the same offsetTop. Stable order within a row
   * follows the document order.
   *
   * @returns {{ rows: HTMLElement[][], rowOf: number[], colOf: number[] }}
   */
  const layoutMap = () => {
    /** @type {Map<number, HTMLElement[]>} */
    const byTop = new Map();
    for (const el of items) {
      const top = el.offsetTop;
      if (!byTop.has(top)) byTop.set(top, []);
      byTop.get(top).push(el);
    }
    const rows = [...byTop.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list);
    /** @type {number[]} */
    const rowOf = new Array(items.length);
    /** @type {number[]} */
    const colOf = new Array(items.length);
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const idx = items.indexOf(rows[r][c]);
        rowOf[idx] = r;
        colOf[idx] = c;
      }
    }
    return { rows, rowOf, colOf };
  };

  /** @param {number} idx */
  const setCursor = (idx) => {
    if (idx === cursor || idx < 0 || idx >= items.length) return;
    items[cursor].tabIndex = -1;
    cursor = idx;
    items[cursor].tabIndex = 0;
    items[cursor].focus({ preventScroll: false });
  };

  /** @param {KeyboardEvent} e */
  const onKeyDown = (e) => {
    if (!NAV_KEYS.has(e.key)) return;
    if (items.length === 0) return;
    // Ignore nav keys typed into a focused input/textarea inside a
    // grid cell (e.g. a search box). Cards are buttons/anchors, not
    // form fields, so this is a defensive check.
    const target = /** @type {Element} */ (e.target);
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;

    const { rows, rowOf, colOf } = layoutMap();
    const r = rowOf[cursor];
    const c = colOf[cursor];

    let next = cursor;
    if (e.key === 'ArrowRight') {
      if (c + 1 < rows[r].length) next = items.indexOf(rows[r][c + 1]);
      else if (wrap && r + 1 < rows.length) next = items.indexOf(rows[r + 1][0]);
    } else if (e.key === 'ArrowLeft') {
      if (c > 0) next = items.indexOf(rows[r][c - 1]);
      else if (wrap && r > 0) {
        const prev = rows[r - 1];
        next = items.indexOf(prev[prev.length - 1]);
      }
    } else if (e.key === 'ArrowDown') {
      if (r + 1 < rows.length) {
        const target = rows[r + 1][Math.min(c, rows[r + 1].length - 1)];
        next = items.indexOf(target);
      }
    } else if (e.key === 'ArrowUp') {
      if (r > 0) {
        const target = rows[r - 1][Math.min(c, rows[r - 1].length - 1)];
        next = items.indexOf(target);
      }
    } else if (e.key === 'Home') {
      next = 0;
    } else if (e.key === 'End') {
      next = items.length - 1;
    }

    if (next !== cursor) {
      e.preventDefault();
      setCursor(next);
    }
  };

  /** @param {FocusEvent} e */
  const onFocusIn = (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const idx = items.indexOf(target);
    if (idx >= 0 && idx !== cursor) {
      items[cursor].tabIndex = -1;
      cursor = idx;
      items[cursor].tabIndex = 0;
    }
  };

  scan();
  grid.addEventListener('keydown', onKeyDown);
  grid.addEventListener('focusin', onFocusIn);

  return {
    refresh() {
      scan();
    },
    focusFirst() {
      if (items.length === 0) return;
      // Don't re-focus if focus is already inside the grid; the user
      // may already be navigating, and re-asserting focus would
      // disrupt their position.
      if (grid.contains(document.activeElement)) return;
      items[cursor].focus({ preventScroll: false });
    },
    dispose() {
      grid.removeEventListener('keydown', onKeyDown);
      grid.removeEventListener('focusin', onFocusIn);
      // Leave tabindex=0 on every child so the grid stays
      // keyboard-reachable after dispose; some callers re-mount the
      // helper later and we don't want a dead grid in the meantime.
      items.forEach((el) => {
        el.tabIndex = 0;
      });
    }
  };
}
