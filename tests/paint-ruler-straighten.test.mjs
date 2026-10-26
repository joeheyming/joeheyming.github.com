// Ruler Straighten Layer (PhotoCraft analysis_cmds.rs straighten_angle / straighten, the
// edit.transform path; analysis_ui.rs options_bar Tool::Ruler 'Straighten Layer').
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOL_OPTION_SCHEMA, straightenAngle } from '../paint/tools.js';
import { straightenImageData } from '../paint/transform.js';
import { historyIconName, FALLBACK_HISTORY_ICON } from '../paint/history.js';

const round4 = (v) => Math.round(v * 1e4) / 1e4;

test('straightenAngle turns the ruler line onto its nearest axis (clockwise degrees)', () => {
  assert.equal(round4(straightenAngle({ start: [50, 50], end: [150, 60] })), -5.7106);
  assert.equal(round4(straightenAngle({ start: [50, 50], end: [150, 40] })), 5.7106);
  assert.equal(round4(straightenAngle({ start: [50, 50], end: [60, -50] })), -5.7106);
  assert.equal(straightenAngle({ start: [10, 20], end: [90, 20] }), 0);
});

test('straightenAngle ignores the protractor', () => {
  const ruler = { start: [50, 50], end: [150, 60] };
  assert.equal(straightenAngle({ ...ruler, protractor: [50, 0] }), straightenAngle(ruler));
});

test('Straighten Layer sits between Use Measurement Scale and Clear, disabled without a ruler', () => {
  const keys = TOOL_OPTION_SCHEMA.ruler.map((o) => o.key);
  const i = keys.indexOf('_rulerStraighten');
  assert.equal(keys[i - 1], 'rulerUseScale');
  assert.equal(keys[i + 1], '_rulerClear');
  const opt = TOOL_OPTION_SCHEMA.ruler[i];
  assert.equal(opt.type, 'action');
  assert.equal(opt.label, 'Straighten Layer');
  assert.equal(opt.disabledWhen.key, 'ruler');
  assert.deepEqual(opt.disabledWhen.values, [null, undefined]);
  const tilted = { start: [50, 50], end: [150, 60] };
  assert.deepEqual(opt.patch({ ruler: tilted }), { _rulerAction: 'straighten', ruler: null });
  // A level line straightens nothing, so the bar keeps it.
  const level = { start: [0, 5], end: [40, 5] };
  assert.deepEqual(opt.patch({ ruler: level }), { _rulerAction: 'straighten', ruler: level });
});

test('Straighten has a history icon', () => {
  assert.notEqual(historyIconName('Straighten'), FALLBACK_HISTORY_ICON);
});

// A 3 × 3 image whose pixel p is (p, 10p, 255 − p, 255).
function grid() {
  const data = new Uint8ClampedArray(9 * 4);
  for (let p = 0; p < 9; p++) data.set([p, 10 * p, 255 - p, 255], p * 4);
  return { width: 3, height: 3, data };
}
const px = (img, x, y) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

test('straightenImageData at 0° is the identity', () => {
  const img = grid();
  const out = straightenImageData(img, 0);
  assert.equal(out.width, 3);
  assert.equal(out.height, 3);
  assert.deepEqual([...out.data], [...img.data]);
});

test('straightenImageData turns 90° clockwise about the centre', () => {
  const img = grid();
  const out = straightenImageData(img, 90);
  // Clockwise: the top-left pixel goes to the top-right, the top-right to the bottom-right.
  assert.deepEqual(px(out, 2, 0), px(img, 0, 0));
  assert.deepEqual(px(out, 2, 2), px(img, 2, 0));
  assert.deepEqual(px(out, 0, 2), px(img, 2, 2));
  assert.deepEqual(px(out, 0, 0), px(img, 0, 2));
  assert.deepEqual(px(out, 1, 1), px(img, 1, 1));
  assert.deepEqual(px(out, 1, 0), px(img, 0, 1));
});

test('straightenImageData keeps the size and leaves the corners transparent off-axis', () => {
  const W = 20;
  const data = new Uint8ClampedArray(W * W * 4).fill(200);
  const out = straightenImageData({ width: W, height: W, data }, 30);
  assert.equal(out.width, W);
  assert.equal(out.height, W);
  for (const [x, y] of [
    [0, 0],
    [W - 1, 0],
    [0, W - 1],
    [W - 1, W - 1]
  ])
    assert.equal(px(out, x, y)[3], 0, `corner ${x}, ${y}`);
  assert.deepEqual(px(out, 10, 10), [200, 200, 200, 200]);
  // The source is not written.
  assert.ok(data.every((v) => v === 200));
});
