// Keyboard and remote cursor for the checkbox grid.
//
// The grid is one canvas, so a D-pad cannot land on a box. The page
// keeps a single cell cursor. A fresh arrow at the edge returns null
// and the page moves focus back to the surrounding controls. A held
// arrow never leaves: it speeds up so the million-cell grid is
// crossable, and clamps at the edge until the hold ends.

/**
 * How far a held key moves.
 * The first presses step one cell so a box can be chosen precisely.
 * A longer hold steps a fraction of the screen, then a screen, then
 * several screens.
 *
 * @param {number} repeats prior auto-repeats; 0 on the first press
 * @param {number} span cells in one screen along this axis
 * @returns {number}
 */
export function holdStep(repeats, span) {
  const page = Math.max(1, span);
  if (repeats < 6) return 1;
  if (repeats < 14) return Math.max(2, Math.round(page / 6));
  if (repeats < 28) return page;
  return page * 8;
}

/**
 * Channel rocker keys from the TV shell, plus the keys the grid handles.
 *
 * @param {string} key
 * @returns {string}
 */
export function cursorKey(key) {
  if (key === 'n' || key === 'N') return 'PageDown';
  if (key === 'p' || key === 'P') return 'PageUp';
  return key;
}

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isCursorKey(key) {
  return (
    key === 'ArrowLeft' ||
    key === 'ArrowRight' ||
    key === 'ArrowUp' ||
    key === 'ArrowDown' ||
    key === 'Home' ||
    key === 'End' ||
    key === 'PageUp' ||
    key === 'PageDown' ||
    key === 'n' ||
    key === 'N' ||
    key === 'p' ||
    key === 'P'
  );
}

/**
 * Next cell, or null when a fresh press leaves the grid.
 *
 * @param {number} cell
 * @param {number} cols
 * @param {number} total
 * @param {string} key
 * @param {{ repeats?: number, page?: number, ends?: boolean }} [opts]
 * `ends` jumps to the first or last cell (Ctrl+Home / Ctrl+End).
 * A null result is only returned when `repeats` is 0 and the cursor
 * is already on that edge.
 * @returns {number | null}
 */
export function nextCell(cell, cols, total, key, opts = {}) {
  if (cols < 1 || total < 1) return 0;
  const clamped = Math.max(0, Math.min(total - 1, cell | 0));
  if (opts.ends && key === 'Home') return 0;
  if (opts.ends && key === 'End') return total - 1;

  const rows = Math.ceil(total / cols);
  const row = Math.floor(clamped / cols);
  const col = clamped % cols;
  const page = Math.max(1, opts.page || 1);
  const repeats = opts.repeats || 0;

  /**
   * @param {number} r
   * @returns {number}
   */
  const widthOf = (r) => {
    if (r < rows - 1) return cols;
    const rem = total % cols;
    return rem === 0 ? cols : rem;
  };

  /**
   * @param {number} r
   * @param {number} c
   * @returns {number}
   */
  const at = (r, c) => {
    const width = widthOf(r);
    const nextCol = Math.max(0, Math.min(width - 1, c));
    return r * cols + nextCol;
  };

  if (key === 'Home') return at(row, 0);
  if (key === 'End') return at(row, widthOf(row) - 1);

  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const width = widthOf(row);
    const step = holdStep(repeats, cols);
    if (key === 'ArrowLeft') {
      if (col === 0) return repeats === 0 ? null : clamped;
      return at(row, col - step);
    }
    if (col >= width - 1) return repeats === 0 ? null : clamped;
    return at(row, col + step);
  }

  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const step = holdStep(repeats, page);
    if (key === 'ArrowUp') {
      if (row === 0) return repeats === 0 ? null : clamped;
      return at(Math.max(0, row - step), col);
    }
    if (row >= rows - 1) return repeats === 0 ? null : clamped;
    return at(Math.min(rows - 1, row + step), col);
  }

  if (key === 'PageUp' || key === 'PageDown') {
    const step = Math.max(page, holdStep(repeats, page));
    if (key === 'PageUp') {
      if (row === 0) return repeats === 0 ? null : clamped;
      return at(Math.max(0, row - step), col);
    }
    if (row >= rows - 1) return repeats === 0 ? null : clamped;
    return at(Math.min(rows - 1, row + step), col);
  }

  return clamped;
}
