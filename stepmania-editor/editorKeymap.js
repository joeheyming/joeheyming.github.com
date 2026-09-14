/**
 * StepMania 5 edit-mode keymap.
 *
 * Ported from the shipped defaults in `Docs/Mapping_keys_for_edit_mode.txt`
 * and the handlers in `src/ScreenEdit.cpp`, so the action names below match
 * StepMania's own function names. Keeping this as a pure function means the
 * mapping can be checked against that table without a browser.
 *
 * Three defaults surprise people coming from other editors:
 *  - Space is LAY_SELECT (an area marker), not play/pause.
 *  - P plays; Ctrl+P from the start, Shift+P from the cursor.
 *  - Enter and Escape return to editing while a preview is running.
 */

/**
 * @typedef {Object} EditAction
 * @property {string} action StepMania function name
 * @property {boolean} [fine] ADJUST_FINE was held (Alt)
 * @property {number} [column] target column for COLUMN_n
 * @property {boolean} [roll] LAY_ROLL was held (Shift)
 * @property {boolean} [preventDefault]
 */

/**
 * @param {KeyboardEvent} e
 * @param {{playing?: boolean}} [context]
 * @returns {EditAction|null}
 */
export function resolveEditAction(e, context = {}) {
  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  const fine = e.altKey;
  const key = e.key;
  const lower = typeof key === 'string' ? key.toLowerCase() : '';
  const hit = (action, extra) => ({ action, fine, preventDefault: true, ...extra });

  if (context.playing && (key === 'Enter' || key === 'Escape')) {
    return hit('RETURN_TO_EDIT');
  }

  if (lower === 'p') {
    if (context.playing) return hit('RETURN_TO_EDIT');
    if (ctrl) return hit('PLAY_FROM_START');
    if (shift) return hit('PLAY_FROM_CURSOR');
    return hit('PLAY_SELECTION');
  }

  if (key === 'F1') return hit('OPEN_INPUT_HELP');
  if (key === 'F5') return hit('OPEN_PREV_STEPS');
  if (key === 'F6') return hit('OPEN_NEXT_STEPS');
  if (ctrl && lower === 's') return hit('SAVE');
  if (ctrl && lower === 'z') return hit(shift ? 'REDO' : 'UNDO');

  switch (key) {
    case ' ':
      return hit('LAY_SELECT');
    case 'ArrowUp':
      return hit(ctrl ? 'SCROLL_SPEED_UP' : 'SCROLL_UP_LINE');
    case 'ArrowDown':
      return hit(ctrl ? 'SCROLL_SPEED_DOWN' : 'SCROLL_DOWN_LINE');
    case 'ArrowLeft':
      return hit('SNAP_NEXT');
    case 'ArrowRight':
      return hit('SNAP_PREV');
    case 'PageUp':
    case ';':
      return hit('SCROLL_UP_PAGE');
    case 'PageDown':
    case "'":
      return hit('SCROLL_DOWN_PAGE');
    case 'Home':
      return hit('SCROLL_HOME');
    case 'End':
      return hit('SCROLL_END');
    case ',':
      return hit('SCROLL_PREV');
    case '.':
      return hit('SCROLL_NEXT');
    case 'Delete':
    case 'Backspace':
      return hit('DELETE');
    case 'F7':
      return hit('BPM_DOWN');
    case 'F8':
      return hit('BPM_UP');
    case 'F9':
      return hit(shift ? 'DELAY_DOWN' : 'STOP_DOWN');
    case 'F10':
      return hit(shift ? 'DELAY_UP' : 'STOP_UP');
    case 'F11':
      return hit('OFFSET_DOWN');
    case 'F12':
      return hit('OFFSET_UP');
    case '[':
      return hit('SAMPLE_START_DOWN');
    case ']':
      return hit('SAMPLE_START_UP');
    case '{':
      return hit('SAMPLE_LENGTH_DOWN');
    case '}':
      return hit('SAMPLE_LENGTH_UP');
    default:
      break;
  }

  if (lower === 'u') return hit('UNDO');
  if (lower === 'n') return hit('CYCLE_TAP_LEFT');
  if (lower === 'm') return hit('CYCLE_TAP_RIGHT');
  if (lower === 'l') return hit('PLAY_SAMPLE_MUSIC');
  if (lower === 't') return hit('SWITCH_TIMINGS');

  const column = { 1: 0, 2: 1, 3: 2, 4: 3 }[key];
  if (column != null) {
    return hit(`COLUMN_${column}`, { column, roll: shift });
  }

  return null;
}
