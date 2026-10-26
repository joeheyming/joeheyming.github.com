import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import {
  pasteIntoMask,
  pasteOffset,
  selectionCenter,
  toggleLastState,
  toggleLastStateDirection
} from '../paint/edit-clipboard.js';
import { COMMANDS, COMMANDS_BY_ID, commandForKey, formatShortcut } from '../paint/commands.js';
import { buildMenuBar } from '../paint/menu-bar.js';
import { STACK_UNDO_LABELS } from '../paint/stack-history.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
const paintJs = readFileSync(new URL('../paint/paint.js', import.meta.url), 'utf8');
const canvas = { w: 100, h: 80 };

// A stack-history stub: undo moves the top entry to redo, redo moves it back.
function history(undo, redo) {
  const h = {
    undoStack: [...undo],
    redoStack: [...redo],
    undo: () => h.redoStack.push(h.undoStack.pop()),
    redo: () => h.undoStack.push(h.redoStack.pop())
  };
  return h;
}

test('Toggle Last State redoes when it can, else undoes', () => {
  assert.equal(toggleLastStateDirection([1], []), 'undo');
  assert.equal(toggleLastStateDirection([1], [2]), 'redo');
  assert.equal(toggleLastStateDirection([], [2]), 'redo');
  assert.equal(toggleLastStateDirection([], []), null);
});

test('Toggle Last State swaps between the current and the previous state', () => {
  const h = history(['a', 'b'], []);
  assert.equal(toggleLastState(h), 'undo');
  assert.deepEqual(h.undoStack, ['a']);
  assert.deepEqual(h.redoStack, ['b']);
  assert.equal(toggleLastState(h), 'redo');
  assert.deepEqual(h.undoStack, ['a', 'b']);
  assert.deepEqual(h.redoStack, []);
  assert.equal(toggleLastState(h), 'undo');
  assert.deepEqual(h.undoStack, ['a']);
  const empty = history([], []);
  assert.equal(toggleLastState(empty), null);
});

test('Paste in Place keeps the copied position, even off the canvas', () => {
  const clip = { x: 30, y: 12, w: 20, h: 10 };
  assert.deepEqual(pasteOffset(clip, canvas, { inPlace: true, center: [5, 5] }), {
    dx: 0,
    dy: 0
  });
  assert.deepEqual(pasteOffset({ x: 90, y: 75, w: 20, h: 10 }, canvas, { inPlace: true }), {
    dx: 0,
    dy: 0
  });
});

test('Paste with no center leaves a clip on the canvas where it was', () => {
  assert.deepEqual(pasteOffset({ x: 30, y: 12, w: 20, h: 10 }, canvas), { dx: 0, dy: 0 });
  // Off the canvas: centred on the canvas centre (50, 40).
  assert.deepEqual(pasteOffset({ x: 90, y: 75, w: 20, h: 10 }, canvas), { dx: -50, dy: -40 });
});

test('Paste centres on the view and stays on the canvas', () => {
  const clip = { x: 10, y: 10, w: 20, h: 10 };
  assert.deepEqual(pasteOffset(clip, canvas, { center: [60, 40] }), { dx: 40, dy: 25 });
  // A centre near the corner would push the clip off; it stops at the edge.
  assert.deepEqual(pasteOffset(clip, canvas, { center: [99, 79] }), { dx: 70, dy: 60 });
  assert.deepEqual(pasteOffset(clip, canvas, { center: [0, 0] }), { dx: -10, dy: -10 });
  // Larger than the canvas: starts at the top-left corner.
  const big = { x: 5, y: 5, w: 150, h: 100 };
  assert.deepEqual(pasteOffset(big, canvas, { center: [50, 40] }), { dx: -5, dy: -5 });
});

test('Paste Into centres on the selection without clamping to the canvas', () => {
  const clip = { x: 0, y: 0, w: 40, h: 20 };
  const sel = { x: 80, y: 70, w: 20, h: 10 };
  assert.deepEqual(selectionCenter(sel), [90, 75]);
  assert.deepEqual(pasteOffset(clip, canvas, { center: selectionCenter(sel), clamp: false }), {
    dx: 70,
    dy: 65
  });
  // Halves round away from zero, as Rust f64::round does.
  assert.deepEqual(
    pasteOffset({ x: 0, y: 0, w: 3, h: 3 }, canvas, { center: [0, 0], clamp: false }),
    { dx: -2, dy: -2 }
  );
});

test('Paste Into reveals only the selection; Paste Outside reveals the rest', () => {
  const W = 4,
    H = 2;
  const sel = Uint8Array.from([0, 1, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual([...pasteIntoMask(sel, W, H, false)], [0, 255, 255, 0, 0, 0, 255, 0]);
  assert.deepEqual([...pasteIntoMask(sel, W, H, true)], [255, 0, 0, 255, 255, 255, 0, 255]);
  const mask = pasteIntoMask(sel, W, H, false);
  assert.ok(mask instanceof Uint8Array);
  assert.equal(mask.length, W * H);
  assert.deepEqual([...sel], [0, 1, 1, 0, 0, 0, 1, 0], 'the selection mask is not changed');
});

test('Edit lists Cut, Copy, Copy Merged, Paste, Paste Special, and Clear with shortcuts', () => {
  const { window } = new JSDOM(html);
  const bar = window.document.getElementById('menu-bar');
  buildMenuBar(bar, COMMANDS, { mac: false });
  const item = (id) => bar.querySelector(`[data-command="${id}"]`);
  const shown = (id) => item(id)?.querySelector('.menu-shortcut')?.textContent ?? '';
  for (const [id, label, sc] of [
    ['edit.toggleLastState', 'Toggle Last State', 'Ctrl+Alt+Z'],
    ['edit.cut', 'Cut', 'Ctrl+X'],
    ['edit.copy', 'Copy', 'Ctrl+C'],
    ['edit.copyMerged', 'Copy Merged', 'Ctrl+Shift+C'],
    ['edit.paste', 'Paste', 'Ctrl+V'],
    ['edit.pasteSpecial.pasteInPlace', 'Paste in Place', 'Ctrl+Shift+V'],
    ['edit.pasteSpecial.pasteInto', 'Paste Into', 'Ctrl+Alt+Shift+V'],
    ['edit.pasteSpecial.pasteOutside', 'Paste Outside', ''],
    ['edit.clear', 'Clear', '']
  ]) {
    assert.ok(item(id), id);
    assert.match(item(id).textContent, new RegExp(label), id);
    assert.equal(shown(id), sc, id);
  }
  const special = bar.querySelector('[data-menu-path="Edit > Paste Special"]');
  assert.ok(special?.querySelector('[data-command="edit.pasteSpecial.pasteInto"]'));
  assert.equal(formatShortcut('Cmd+Alt+Shift+V', true), '⌥⇧⌘V');
});

test('the new shortcuts resolve; Cmd+V stays with the paste event', () => {
  const id = (e) => commandForKey(e)?.id ?? null;
  const k = (code, mods) => ({ key: code.slice(3).toLowerCase(), code, ...mods });
  assert.equal(id(k('KeyZ', { ctrlKey: true, altKey: true })), 'edit.toggleLastState');
  assert.equal(id(k('KeyC', { ctrlKey: true, shiftKey: true })), 'edit.copyMerged');
  assert.equal(id(k('KeyV', { ctrlKey: true, shiftKey: true })), 'edit.pasteSpecial.pasteInPlace');
  assert.equal(
    id(k('KeyV', { ctrlKey: true, altKey: true, shiftKey: true })),
    'edit.pasteSpecial.pasteInto'
  );
  assert.equal(id(k('KeyV', { metaKey: true })), 'edit.paste');
  assert.match(paintJs, /cmd\.id !== 'edit\.paste'/);
});

test('Paste Special items enable on clipboard and selection state', () => {
  const inPlace = COMMANDS_BY_ID.get('edit.pasteSpecial.pasteInPlace');
  const into = COMMANDS_BY_ID.get('edit.pasteSpecial.pasteInto');
  const outside = COMMANDS_BY_ID.get('edit.pasteSpecial.pasteOutside');
  const sel = { mode: 'active', x: 0, y: 0, w: 4, h: 4 };
  const clip = { data: {}, x: 2, y: 3, w: 4, h: 4 };
  assert.equal(inPlace.enabled({ clipboard: null }), false);
  assert.equal(inPlace.enabled({ clipboard: { data: {}, w: 1, h: 1 } }), false, 'no position');
  assert.equal(inPlace.enabled({ clipboard: clip }), true);
  assert.equal(into.enabled({ clipboard: clip, sel: { mode: 'none' } }), false);
  assert.equal(into.enabled({ clipboard: null, sel }), false);
  assert.equal(into.enabled({ clipboard: clip, sel }), true);
  assert.equal(outside.enabled({ clipboard: clip, sel }), true);
});

test('Toggle Last State is off with no history and while Free Transform runs', () => {
  const t = COMMANDS_BY_ID.get('edit.toggleLastState');
  assert.equal(t.enabled({ undoStack: [], redoStack: [] }), false);
  assert.equal(t.enabled({ undoStack: [{}], redoStack: [] }), true);
  assert.equal(t.enabled({ undoStack: [], redoStack: [{}] }), true);
  assert.equal(t.enabled({ undoStack: [{}], redoStack: [], freeTransform: {} }), false);
});

test('Paste Into and Paste Outside take one whole-stack undo', () => {
  assert.ok(STACK_UNDO_LABELS.has('Paste Into'));
  assert.ok(STACK_UNDO_LABELS.has('Paste Outside'));
});
