/**
 * QWERTY → Stradella grid mapping for the horizontal bass view.
 *
 * The four letter rows of a keyboard are already staggered diagonally,
 * just like the Stradella rows, so each keyboard row drives one bass row
 * and each key position drives one column (left → right):
 *
 *   1 2 3 … 0   → first row   (counter-bass on a standard layout)
 *   Q W E … P   → second row  (bass)
 *   A S D … ;   → third row   (major)
 *   Z X C … /   → fourth row  (minor)
 *
 * Shift is a live chord swap: while it is held, the major row plays
 * dominant 7ths and the minor row plays diminished 7ths. The note rows
 * are unchanged. Releasing Shift puts a still-held chord back.
 *
 * Rows and columns are counted from the *visual* top-left, so the mapping
 * follows the Flip control.
 *
 * Uses `KeyboardEvent.code` (physical position), so Shift and non-US
 * layouts don't change which button a key lands on.
 */

const KEY_ROWS = [
  [
    'Digit1',
    'Digit2',
    'Digit3',
    'Digit4',
    'Digit5',
    'Digit6',
    'Digit7',
    'Digit8',
    'Digit9',
    'Digit0'
  ],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'],
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash']
];

const KEY_POSITIONS = new Map();
KEY_ROWS.forEach((codes, keyRow) => {
  codes.forEach((code, col) => KEY_POSITIONS.set(code, { keyRow, col }));
});

/** True when the key is one of the four grid rows, whether or not this layout has a button there. */
export function isStradellaKey(code) {
  return KEY_POSITIONS.has(code);
}

/**
 * Resolve a physical key to a grid cell.
 *
 * @param {string} code      `KeyboardEvent.code`
 * @param {boolean} shiftKey whether Shift is held
 * @param {{ rowCount: number, colCount: number, flip?: string }} grid
 * @returns {{ row: number, col: number } | null} indices into the rendered
 *   rows / buttons, or null when the key has no button on this grid
 */
export function stradellaCellForKey(code, shiftKey, grid) {
  const pos = KEY_POSITIONS.get(code);
  if (!pos) return null;
  let row = pos.keyRow;
  // Shift only swaps the two chord rows (major → dom 7, minor → dim 7).
  if (shiftKey && row >= 2) row += 2;
  let col = pos.col;
  if (row >= grid.rowCount || col >= grid.colCount) return null;
  const flip = grid.flip || 'normal';
  if (flip === 'horizontal' || flip === 'both') col = grid.colCount - 1 - col;
  if (flip === 'vertical' || flip === 'both') row = grid.rowCount - 1 - row;
  return { row, col };
}
