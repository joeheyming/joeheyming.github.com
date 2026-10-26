import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FADE_MODES,
  canFade,
  fadePixels,
  fadeableLabels,
  lastFilterLabel,
  noteFadeStep,
  recordLastFilter
} from '../paint/fade.js';
import { ADJUSTMENTS } from '../paint/adjustments.js';
import { TOOLS } from '../paint/tools.js';
import { COMMANDS_BY_ID, FILTER_IDS } from '../paint/commands.js';
import { historyIconName } from '../paint/history.js';

const W = 8,
  H = 6;

function image(at) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set(at(x, y), (y * W + x) * 4);
  return { width: W, height: H, data };
}

const stripes = () => image((x) => (x % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));

test('Fade 50% Normal averages the pixels before and after the step', () => {
  const before = image(() => [200, 40, 0, 255]);
  const after = image(() => [100, 240, 60, 255]);
  fadePixels(before.data, after.data, 50, 'source-over');
  for (let p = 0; p < W * H; p++) {
    assert.deepEqual([...after.data.subarray(p * 4, p * 4 + 4)], [150, 140, 30, 255]);
  }
});

test('Fade at 100% keeps the step and at 0% takes it back', () => {
  const before = stripes();
  const blurred = stripes();
  ADJUSTMENTS.gaussianBlur.apply(blurred, { radius: 2 }, null);
  const full = blurred.data.slice();
  fadePixels(before.data, full, 100);
  assert.deepEqual(full, blurred.data);
  const none = blurred.data.slice();
  fadePixels(before.data, none, 0);
  assert.deepEqual(none, before.data);
});

test('Fade blends alpha premultiplied: half of a cleared pixel is half-transparent', () => {
  const before = image(() => [255, 0, 0, 255]);
  const after = image(() => [0, 0, 0, 0]);
  fadePixels(before.data, after.data, 50);
  assert.deepEqual([...after.data.subarray(0, 4)], [255, 0, 0, 128]);
});

test('Fade Mode composites the step over the old pixels before fading', () => {
  const before = image(() => [200, 100, 50, 255]);
  const after = image(() => [128, 128, 128, 255]);
  fadePixels(before.data, after.data, 100, 'multiply');
  // Multiply by ~0.5 halves each channel of the pre-step pixels.
  assert.deepEqual([...after.data.subarray(0, 4)], [100, 50, 25, 255]);
  assert.equal(FADE_MODES[0].label, 'Normal');
  assert.ok(FADE_MODES.some((m) => m.value === 'luminosity'));
});

test('Fade is enabled right after a filter, adjustment, or stroke, and only then', () => {
  const labels = fadeableLabels(ADJUSTMENTS, TOOLS);
  for (const label of ['Gaussian Blur', 'Levels', TOOLS.brush.label, 'Fill', 'Stroke']) {
    assert.ok(labels.has(label), label);
  }
  assert.ok(!labels.has(TOOLS.rectSelect.label));
  assert.ok(!labels.has('Canvas Size'));

  const layer = { id: 7 };
  const state = { layers: [layer], activeLayerIdx: 0, undoStack: [] };
  assert.equal(canFade(state), false);
  state.undoStack.push({ label: 'Gaussian Blur', layerId: 7, data: stripes() });
  noteFadeStep(state, 'Gaussian Blur', labels);
  assert.equal(canFade(state), true);
  assert.equal(COMMANDS_BY_ID.get('edit.fade').enabled(state), true);

  // Any later step turns it off; so does undoing the faded one.
  state.undoStack.push({ label: 'Rectangular Marquee', layerId: 7, data: stripes() });
  assert.equal(canFade(state), false);
  state.undoStack.pop();
  assert.equal(canFade(state), true);
  state.undoStack.pop();
  assert.equal(canFade(state), false);

  // A non-fadeable step clears the source.
  state.undoStack.push({ label: 'Canvas Size', stack: {} });
  noteFadeStep(state, 'Canvas Size', labels);
  assert.equal(state.fadeSource, null);
});

test('Fade runs openFade with its catalog shortcut; its history row takes the step icon', () => {
  const cmd = COMMANDS_BY_ID.get('edit.fade');
  assert.equal(cmd.label, 'Fade…');
  assert.deepEqual(cmd.menu, ['Edit']);
  assert.equal(cmd.shortcut, 'Cmd+Shift+F');
  let opened = 0;
  cmd.run({ openFade: () => opened++ });
  assert.equal(opened, 1);
  assert.equal(historyIconName('Fade Gaussian Blur'), historyIconName('Gaussian Blur'));
});

test('Last Filter reruns the last Filter menu command with the same params', () => {
  const state = { layers: [{ id: 1, kind: 'pixel' }], activeLayerIdx: 0 };
  const cmd = COMMANDS_BY_ID.get('filter.lastFilter');
  assert.deepEqual(cmd.menu, ['Filter']);
  assert.equal(cmd.shortcut, 'Cmd+Alt+F');
  assert.equal(cmd.enabled(state), false, 'nothing to repeat yet');
  assert.equal(cmd.labelFor(state), 'Last Filter');

  assert.ok(FILTER_IDS.has('gaussianBlur'));
  assert.ok(!FILTER_IDS.has('levels'), 'adjustments are not filters');
  const params = { radius: 3 };
  recordLastFilter(state, 'gaussianBlur', params);
  params.radius = 9; // the dialog's object is not shared
  assert.deepEqual(state.lastFilter, { id: 'gaussianBlur', params: { radius: 3 } });
  assert.equal(cmd.enabled(state), true);
  assert.equal(cmd.labelFor(state), 'Last Filter (Gaussian Blur)');

  let ran = 0;
  cmd.run({ runLastFilter: () => ran++ });
  assert.equal(ran, 1);

  // Rerunning applies the recorded settings: twice through Last Filter equals two radius-3 blurs.
  const once = stripes();
  ADJUSTMENTS.gaussianBlur.apply(once, { radius: 3 }, null);
  const again = stripes();
  ADJUSTMENTS[state.lastFilter.id].apply(again, { ...state.lastFilter.params }, null);
  assert.deepEqual(again.data, once.data);
  const nine = stripes();
  ADJUSTMENTS.gaussianBlur.apply(nine, { radius: 9 }, null);
  assert.notDeepEqual(again.data, nine.data);
});
