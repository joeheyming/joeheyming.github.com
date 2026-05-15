/**
 * Accordion Hero input: pointer + keyboard.
 *
 * Column-based keyboard layout — each Stradella column gets a vertical
 * slice of four physical keys (top → bottom on the keyboard maps to
 * top → bottom on the lane bar):
 *
 *      col 0:  1 q a z      col 5:  6 y h n
 *      col 1:  2 w s x      col 6:  7 u j m
 *      col 2:  3 e d c      col 7:  8 i k ,
 *      col 3:  4 r f v      col 8:  9 o l .
 *      col 4:  5 t g b      col 9:  0 p ; /
 *
 * Within a column, lanes are listed in Stradella row order (bass →
 * counter-bass → major → minor → dom7 → dim7) and the first lane gets
 * the top key, the second gets the Q-row key, and so on. Because most
 * songs use ≤ 4 chord types in any one column, four keys per column is
 * enough — and every (column, chord-row) cell ends up with its own
 * unique key, so a single keypress never fires two lanes at once.
 *
 * Touch / pointer input is unchanged: every on-screen button has its
 * own lane via `data-lanes`, so multi-touch fires whichever cells you
 * tap.
 */

const KEYBOARD_COLS = [
  ['1', 'q', 'a', 'z'],
  ['2', 'w', 's', 'x'],
  ['3', 'e', 'd', 'c'],
  ['4', 'r', 'f', 'v'],
  ['5', 't', 'g', 'b'],
  ['6', 'y', 'h', 'n'],
  ['7', 'u', 'j', 'm'],
  ['8', 'i', 'k', ','],
  ['9', 'o', 'l', '.'],
  ['0', 'p', ';', '/']
];

// Re-exported for the docs / inspector tooling.
export { KEYBOARD_COLS };

/**
 * Build a Map<laneIndex, key> for the given lanes.
 *
 * Lanes in the same column are sorted by `rowIndex` (Stradella row
 * order; see `ROW_ORDER` in lane-engine.js) and then assigned keys top
 * to bottom from `KEYBOARD_COLS[colIndex]`. Lanes whose column lies
 * outside the 10-column keyboard or whose intra-column position
 * overflows the 4-slot stack get no key (they can still be tapped on
 * screen).
 */
export function buildKeyMap(lanes) {
  const byCol = new Map();
  for (const lane of lanes) {
    let entry = byCol.get(lane.colIndex);
    if (!entry) {
      entry = [];
      byCol.set(lane.colIndex, entry);
    }
    entry.push(lane);
  }
  const laneToKey = new Map();
  for (const [colIdx, lanesInCol] of byCol.entries()) {
    const colKeys = KEYBOARD_COLS[colIdx];
    if (!colKeys) continue;
    lanesInCol.sort((a, b) => a.rowIndex - b.rowIndex);
    lanesInCol.forEach((lane, pos) => {
      const key = colKeys[pos];
      if (key) laneToKey.set(lane.index, key);
    });
  }
  return laneToKey;
}

/**
 * Pretty-print a key for the on-button label. Single-char keys get
 * uppercased so the letters read clearly against the dark buttons;
 * digits and punctuation pass through.
 */
export function keyLabelForLaneIndex(laneToKey, laneIndex) {
  const k = laneToKey.get(laneIndex);
  if (!k) return '';
  return k.length === 1 && /[a-z]/.test(k) ? k.toUpperCase() : k;
}

/**
 * Wire up pointer + keyboard input. Returns a dispose() function.
 *
 * `laneToKey` is the pre-computed Map from `buildKeyMap` so the key
 * assignments match the labels rendered on the lane bar.
 */
export function attachInput({ laneBarEl, laneToKey, engine, callbacks }) {
  const buttons = Array.from(laneBarEl.querySelectorAll('.ah-col-btn'));

  const parseLanes = (btn) =>
    (btn.dataset.lanes || '').split(',').map(Number).filter(n => !Number.isNaN(n));

  // ----- Pointer input -----

  const onDown = (e) => {
    const btn = e.currentTarget;
    btn.setPointerCapture(e.pointerId);
    btn.classList.add('is-active');
    const t = performance.now() / 1000;
    for (const idx of parseLanes(btn)) engine.pressLane(idx, t, callbacks);
  };

  const onUp = (e) => {
    const btn = e.currentTarget;
    btn.classList.remove('is-active');
    const t = performance.now() / 1000;
    for (const idx of parseLanes(btn)) engine.releaseLane(idx, t, callbacks);
  };

  for (const btn of buttons) {
    btn.addEventListener('pointerdown', onDown);
    btn.addEventListener('pointerup', onUp);
    btn.addEventListener('pointercancel', onUp);
    btn.addEventListener('pointerleave', (e) => { if (e.buttons === 0) onUp(e); });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ----- Keyboard input -----
  //
  // Invert laneToKey → keyMap: physical key → [laneIndex, …]. Because
  // every (col, row) cell got its own key in `buildKeyMap`, each list
  // here is normally a single lane.

  const keyMap = new Map();
  for (const [laneIdx, key] of laneToKey.entries()) {
    if (!keyMap.has(key)) keyMap.set(key, []);
    keyMap.get(key).push(laneIdx);
  }

  const buttonByLaneIndex = new Map(
    buttons.map(btn => [Number(btn.dataset.lanes), btn])
  );

  const keyDown = new Set();

  const onKeyDown = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    const indices = keyMap.get(key);
    if (!indices || keyDown.has(key)) return;
    keyDown.add(key);
    e.preventDefault();
    const t = performance.now() / 1000;
    for (const idx of indices) {
      buttonByLaneIndex.get(idx)?.classList.add('is-active');
      engine.pressLane(idx, t, callbacks);
    }
  };

  const onKeyUp = (e) => {
    const key = e.key.toLowerCase();
    if (!keyDown.has(key)) return;
    keyDown.delete(key);
    const indices = keyMap.get(key);
    if (!indices) return;
    const t = performance.now() / 1000;
    for (const idx of indices) {
      buttonByLaneIndex.get(idx)?.classList.remove('is-active');
      engine.releaseLane(idx, t, callbacks);
    }
  };

  const onBlur = () => {
    const t = performance.now() / 1000;
    for (const key of [...keyDown]) {
      const indices = keyMap.get(key);
      if (indices) for (const idx of indices) {
        buttonByLaneIndex.get(idx)?.classList.remove('is-active');
        engine.releaseLane(idx, t, callbacks);
      }
    }
    keyDown.clear();
  };

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return function dispose() {
    for (const btn of buttons) {
      btn.removeEventListener('pointerdown', onDown);
      btn.removeEventListener('pointerup', onUp);
      btn.removeEventListener('pointercancel', onUp);
      btn.classList.remove('is-active');
    }
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    engine.releaseAll(callbacks);
  };
}
