import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { TOOLS, defaultToolOptions } from '../paint/tools.js';

// A stub overlay context that ignores every draw call.
function overlay(width = 200, height = 100) {
  const target = { canvas: { width, height } };
  return new Proxy(target, {
    get: (t, key) => (key in t ? t[key] : () => {}),
    set: (t, key, value) => ((t[key] = value), true)
  });
}

function cropState(ov) {
  const state = { toolOptions: defaultToolOptions(), zoom: 1 };
  TOOLS.crop.ensureFrame(ov, state, 200, 100, null);
  state.cropFrame = [40, 30, 100, 70];
  state.cropDefault = false;
  return state;
}

function drag(ov, state, [x0, y0], [x1, y1]) {
  TOOLS.crop.onDown(null, ov, state, x0, y0);
  TOOLS.crop.onMove(null, ov, state, x1, y1);
  TOOLS.crop.onUp(null, ov, state, x1, y1);
}

test('Edit Undo steps the crop box, not the document (edit_undo_steps_the_crop_box_not_the_document)', () => {
  const ov = overlay();
  const state = cropState(ov);
  drag(ov, state, [70, 50], [90, 50]);
  assert.equal(state.cropFrame[0], 60);
  assert.equal(state.cropUndo.length, 1);
  assert.equal(TOOLS.crop.stepHistory(ov, state, false), true);
  assert.deepEqual(state.cropFrame, [40, 30, 100, 70]);
  assert.equal(state.cropDefault, false);
  assert.equal(TOOLS.crop.stepHistory(ov, state, true), true);
  assert.equal(state.cropFrame[0], 60);
});

test('box Undo and Redo grey out when their stack is empty (box_undo_and_redo_grey_out_when_their_stack_is_empty)', () => {
  const ov = overlay();
  const state = cropState(ov);
  assert.equal(TOOLS.crop.historyEnabled(state, 'undo'), null, 'no box history: the document');
  assert.equal(TOOLS.crop.historyEnabled(state, 'redo'), null);
  drag(ov, state, [70, 50], [90, 50]);
  assert.equal(TOOLS.crop.historyEnabled(state, 'undo'), true);
  assert.equal(TOOLS.crop.historyEnabled(state, 'redo'), false);
  TOOLS.crop.stepHistory(ov, state, false);
  assert.equal(TOOLS.crop.historyEnabled(state, 'undo'), false);
  assert.equal(TOOLS.crop.historyEnabled(state, 'redo'), true);
  const f = state.cropFrame.slice();
  assert.equal(TOOLS.crop.stepHistory(ov, state, false), false, 'nothing to undo');
  assert.deepEqual(state.cropFrame, f);
});

test('a click that changes nothing pushes no step', () => {
  const ov = overlay();
  const state = cropState(ov);
  drag(ov, state, [70, 50], [70, 50]);
  assert.equal(state.cropUndo?.length ?? 0, 0);
  assert.equal(TOOLS.crop.historyEnabled(state, 'undo'), null);
});

test('a new gesture clears Redo; turn and Straighten push steps', () => {
  const ov = overlay();
  const state = cropState(ov);
  drag(ov, state, [70, 50], [90, 50]);
  TOOLS.crop.stepHistory(ov, state, false);
  assert.equal(state.cropRedo.length, 1);
  // Outside the frame turns it.
  drag(ov, state, [150, 50], [150, 80]);
  assert.notEqual(state.cropAngle, 0);
  assert.equal(state.cropRedo.length, 0);
  assert.equal(state.cropUndo.length, 1);
  TOOLS.crop.straighten(ov, state, [10, 10], [190, 20]);
  assert.equal(state.cropUndo.length, 2);
  const turned = state.cropUndo[1];
  TOOLS.crop.stepHistory(ov, state, false);
  assert.equal(state.cropAngle, turned.angle);
  assert.deepEqual(state.cropFrame, turned.frame);
});

test('cancel clears both stacks', () => {
  const ov = overlay();
  const state = cropState(ov);
  drag(ov, state, [70, 50], [90, 50]);
  drag(ov, state, [70, 50], [80, 50]);
  TOOLS.crop.stepHistory(ov, state, false);
  TOOLS.crop.cancel(ov, state);
  assert.deepEqual(state.cropUndo, []);
  assert.deepEqual(state.cropRedo, []);
  assert.equal(TOOLS.crop.historyEnabled(state, 'undo'), null);
});

test('paint.js routes Ctrl/Cmd+Z and the undo buttons through the crop box history', () => {
  const src = readFileSync(new URL('../paint/paint.js', import.meta.url), 'utf8');
  const step = src.match(/function cropHistoryStep\(redo\) \{[\s\S]*?\n\}/);
  assert.ok(step, 'cropHistoryStep missing');
  assert.match(step[0], /TOOLS\.crop\.stepHistory\(ov, state, redo\)/);
  // History controller intercepts Undo/Redo via beforeUndo / beforeRedo → cropHistoryStep.
  assert.match(src, /beforeUndo: \(\) => \{[\s\S]*?return cropHistoryStep\(false\);/);
  assert.match(src, /beforeRedo: \(\) => cropHistoryStep\(true\)/);
  // Ctrl/Cmd+Z resolves to edit.undo in COMMANDS, which runs ctx.undo (history Adapter).
  assert.match(src, /const cmd = commandForKey\(e\);/);
  const cmds = readFileSync(new URL('../paint/commands.js', import.meta.url), 'utf8');
  assert.match(cmds, /command\('edit\.undo', \(ctx\) => ctx\.undo\(\), \{\n\s+shortcut: 'Cmd\+Z'/);
  assert.match(src, /commandCtx = createCommandCtx\([\s\S]*?\bundo\b/);
  assert.match(
    readFileSync(new URL('../paint/command-ctx.js', import.meta.url), 'utf8'),
    /\bundo:\s*p\.undo\b/
  );

  // Undo / Redo enable through the crop box history (commands.js historyEnabled); the
  // buttons are menu items, so updateUndoButtons just refreshes the menus.
  const buttons = src.match(/function updateUndoButtons\(\) \{[\s\S]*?\n\}/);
  assert.match(buttons[0], /refreshMenus\(\)/);
  assert.match(cmds, /TOOLS\.crop\.historyEnabled\(state, which\)/);
  assert.match(cmds, /enabled: \(state\) => historyEnabled\(state, 'undo'\)/);
  assert.match(cmds, /enabled: \(state\) => historyEnabled\(state, 'redo'\)/);
});
