import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveEditAction } from '../editorKeymap.js';

/** @param {string} key @param {object} [mods] */
function press(key, mods = {}) {
  return resolveEditAction(
    {
      key,
      ctrlKey: !!mods.ctrl,
      metaKey: !!mods.meta,
      shiftKey: !!mods.shift,
      altKey: !!mods.alt
    },
    { playing: !!mods.playing }
  );
}

/** @param {string} key @param {string} action @param {object} [mods] */
function assertMaps(key, action, mods = {}) {
  const hit = press(key, mods);
  assert.ok(hit, `${key} produced no action`);
  assert.equal(hit.action, action, `${key} should map to ${action}`);
}

test('Space lays an area marker, it is not play/pause', () => {
  assertMaps(' ', 'LAY_SELECT');
});

test('P variants match the shipped PLAY_* mapping', () => {
  assertMaps('p', 'PLAY_SELECTION');
  assertMaps('p', 'PLAY_FROM_CURSOR', { shift: true });
  assertMaps('p', 'PLAY_FROM_START', { ctrl: true });
  assertMaps('P', 'PLAY_SELECTION');
});

test('Enter, Escape and P return to edit while playing', () => {
  assertMaps('Enter', 'RETURN_TO_EDIT', { playing: true });
  assertMaps('Escape', 'RETURN_TO_EDIT', { playing: true });
  assertMaps('p', 'RETURN_TO_EDIT', { playing: true });
});

test('Enter and Escape do nothing while editing', () => {
  assert.equal(press('Enter'), null);
  assert.equal(press('Escape'), null);
});

test('arrows scroll by line and cycle snap', () => {
  assertMaps('ArrowUp', 'SCROLL_UP_LINE');
  assertMaps('ArrowDown', 'SCROLL_DOWN_LINE');
  assertMaps('ArrowLeft', 'SNAP_NEXT');
  assertMaps('ArrowRight', 'SNAP_PREV');
});

test('Ctrl with the vertical arrows changes scroll speed', () => {
  assertMaps('ArrowUp', 'SCROLL_SPEED_UP', { ctrl: true });
  assertMaps('ArrowDown', 'SCROLL_SPEED_DOWN', { ctrl: true });
});

test('page, home, end and note-to-note scrolling', () => {
  assertMaps('PageUp', 'SCROLL_UP_PAGE');
  assertMaps(';', 'SCROLL_UP_PAGE');
  assertMaps('PageDown', 'SCROLL_DOWN_PAGE');
  assertMaps("'", 'SCROLL_DOWN_PAGE');
  assertMaps('Home', 'SCROLL_HOME');
  assertMaps('End', 'SCROLL_END');
  assertMaps(',', 'SCROLL_PREV');
  assertMaps('.', 'SCROLL_NEXT');
});

test('1-4 lay notes in a column, Shift lays a roll', () => {
  for (const [key, column] of [
    ['1', 0],
    ['2', 1],
    ['3', 2],
    ['4', 3]
  ]) {
    const hit = press(key);
    assert.equal(hit.action, `COLUMN_${column}`);
    assert.equal(hit.column, column);
    assert.equal(hit.roll, false);
  }
  assert.equal(press('2', { shift: true }).roll, true);
});

test('function keys adjust timing, Shift swaps stop for delay', () => {
  assertMaps('F7', 'BPM_DOWN');
  assertMaps('F8', 'BPM_UP');
  assertMaps('F9', 'STOP_DOWN');
  assertMaps('F10', 'STOP_UP');
  assertMaps('F9', 'DELAY_DOWN', { shift: true });
  assertMaps('F10', 'DELAY_UP', { shift: true });
  assertMaps('F11', 'OFFSET_DOWN');
  assertMaps('F12', 'OFFSET_UP');
});

test('brackets adjust the sample, shifted brackets its length', () => {
  assertMaps('[', 'SAMPLE_START_DOWN');
  assertMaps(']', 'SAMPLE_START_UP');
  assertMaps('{', 'SAMPLE_LENGTH_DOWN');
  assertMaps('}', 'SAMPLE_LENGTH_UP');
});

test('Alt marks the adjustment as fine', () => {
  assert.equal(press('F8').fine, false);
  assert.equal(press('F8', { alt: true }).fine, true);
});

test('letter shortcuts match the defaults', () => {
  assertMaps('u', 'UNDO');
  assertMaps('n', 'CYCLE_TAP_LEFT');
  assertMaps('m', 'CYCLE_TAP_RIGHT');
  assertMaps('l', 'PLAY_SAMPLE_MUSIC');
  assertMaps('t', 'SWITCH_TIMINGS');
});

test('browser conventions are kept alongside the SM defaults', () => {
  assertMaps('s', 'SAVE', { ctrl: true });
  assertMaps('s', 'SAVE', { meta: true });
  assertMaps('z', 'UNDO', { ctrl: true });
  assertMaps('z', 'REDO', { ctrl: true, shift: true });
  assertMaps('Delete', 'DELETE');
  assertMaps('Backspace', 'DELETE');
});

test('F1 opens the input help, as in edit mode', () => {
  assertMaps('F1', 'OPEN_INPUT_HELP');
});

test('F5 and F6 switch to the previous or next chart', () => {
  assertMaps('F5', 'OPEN_PREV_STEPS');
  assertMaps('F6', 'OPEN_NEXT_STEPS');
});

test('unmapped keys are ignored so typing never steals focus actions', () => {
  assert.equal(press('q'), null);
  assert.equal(press('9'), null);
});
