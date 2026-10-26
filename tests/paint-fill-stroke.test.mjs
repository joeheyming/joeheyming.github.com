import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fillContentsSource,
  fillMask,
  strokeBand,
  strokeMask,
  strokeWidth
} from '../paint/fill-stroke.js';
import { COMMANDS_BY_ID, commandForKey } from '../paint/commands.js';

const W = 21,
  H = 21;

function image(rgba = [0, 0, 0, 0]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) data.set(rgba, p * 4);
  return { width: W, height: H, data };
}

// A 9×9 square selection at (6, 6)..(14, 14).
function square() {
  const m = new Uint8Array(W * H);
  for (let y = 6; y < 15; y++) for (let x = 6; x < 15; x++) m[y * W + x] = 1;
  return m;
}

const px = (img, x, y) => Array.from(img.data.slice((y * W + x) * 4, (y * W + x) * 4 + 4));

// Stroked columns along the row through the square's middle (y = 10).
function rowSpan(band, y = 10) {
  const xs = [];
  for (let x = 0; x < W; x++) if (band[y * W + x]) xs.push(x);
  return xs;
}

const colors = { fg: '#ff0000', bg: '#0000ff', color: '#336699' };

test('Fill contents resolve to PhotoCraft colors', () => {
  assert.deepEqual(fillContentsSource('foreground', colors), [255, 0, 0, 255]);
  assert.deepEqual(fillContentsSource('background', colors), [0, 0, 255, 255]);
  assert.deepEqual(fillContentsSource('color', colors), [0x33, 0x66, 0x99, 255]);
  assert.deepEqual(fillContentsSource('black', colors), [0, 0, 0, 255]);
  assert.deepEqual(fillContentsSource('gray', colors), [128, 128, 128, 255]);
  assert.deepEqual(fillContentsSource('white', colors), [255, 255, 255, 255]);
  const tile = { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) };
  assert.equal(fillContentsSource('pattern', colors, tile), tile);
});

test('Fill writes only inside the mask, or everywhere with no mask', () => {
  const img = image();
  fillMask(img, square(), fillContentsSource('gray', colors));
  assert.deepEqual(px(img, 10, 10), [128, 128, 128, 255]);
  assert.deepEqual(px(img, 6, 6), [128, 128, 128, 255]);
  assert.deepEqual(px(img, 5, 10), [0, 0, 0, 0]);
  const all = image();
  fillMask(all, null, [255, 255, 255, 255]);
  assert.deepEqual(px(all, 0, 0), [255, 255, 255, 255]);
});

test('Fill opacity composites source over and blend modes use blendRgb', () => {
  const img = image([0, 0, 255, 255]);
  fillMask(img, null, [255, 0, 0, 255], { opacity: 50 });
  assert.deepEqual(px(img, 3, 3), [128, 0, 128, 255]);
  const mul = image([128, 255, 255, 255]);
  fillMask(mul, null, [128, 128, 0, 255], { mode: 'multiply' });
  assert.deepEqual(px(mul, 0, 0), [64, 128, 0, 255]);
});

test('Fill Preserve Transparency keeps every alpha', () => {
  const img = image();
  img.data.set([0, 0, 255, 128], (10 * W + 10) * 4);
  fillMask(img, square(), [255, 0, 0, 255], { preserveTransparency: true });
  assert.equal(px(img, 7, 7)[3], 0, 'transparent stays transparent');
  assert.deepEqual(px(img, 10, 10), [255, 0, 0, 128], 'half alpha takes the color, keeps alpha');
  const plain = image();
  fillMask(plain, square(), [255, 0, 0, 255]);
  assert.deepEqual(px(plain, 7, 7), [255, 0, 0, 255]);
});

test('Fill with a pattern repeats it from the canvas origin', () => {
  const tile = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255])
  };
  const img = image();
  fillMask(img, square(), tile);
  assert.deepEqual(px(img, 6, 6), [255, 255, 255, 255]);
  assert.deepEqual(px(img, 7, 6), [0, 0, 0, 255]);
});

test('Stroke width is whole pixels, 1..250, rounded up', () => {
  assert.equal(strokeWidth(0.5), 1);
  assert.equal(strokeWidth(2.2), 3);
  assert.equal(strokeWidth(999), 250);
  assert.equal(strokeWidth('x'), 1);
});

test('Stroke Inside / Center / Outside widths on a 9×9 square', () => {
  const m = square();
  assert.deepEqual(rowSpan(strokeBand(m, W, H, 2, 'inside')), [6, 7, 13, 14]);
  assert.deepEqual(rowSpan(strokeBand(m, W, H, 2, 'outside')), [4, 5, 15, 16]);
  // Center: 3 px is 1 outside, 2 inside.
  assert.deepEqual(rowSpan(strokeBand(m, W, H, 3, 'center')), [5, 6, 7, 13, 14, 15]);
  // 1 px Center is all inside.
  assert.deepEqual(rowSpan(strokeBand(m, W, H, 1, 'center')), [6, 14]);
  // Inside never leaves the selection; Outside never enters it.
  const inside = strokeBand(m, W, H, 4, 'inside');
  const outside = strokeBand(m, W, H, 4, 'outside');
  for (let p = 0; p < m.length; p++) {
    if (inside[p]) assert.equal(m[p], 1);
    if (outside[p]) assert.equal(m[p], 0);
  }
  // An Inside band covers the square's edge ring and leaves its middle.
  assert.equal(inside[6 * W + 6], 1);
  assert.equal(inside[10 * W + 10], 0);
});

test('Stroke Outside rounds the corners', () => {
  const band = strokeBand(square(), W, H, 2, 'outside');
  assert.equal(band[5 * W + 5], 1, 'diagonal neighbour of the corner');
  assert.equal(band[4 * W + 4], 1, 'distance 2√2 < 3');
  assert.equal(band[3 * W + 3], 0);
});

test('The canvas edge strokes like a selection edge', () => {
  const all = new Uint8Array(W * H).fill(1);
  const band = strokeBand(all, W, H, 2, 'inside');
  assert.deepEqual(rowSpan(band), [0, 1, 19, 20]);
});

test('strokeMask paints the band with mode and opacity', () => {
  const img = image([255, 255, 255, 255]);
  strokeMask(img, square(), [0, 0, 0, 255], { width: 2, location: 'inside', opacity: 50 });
  assert.deepEqual(px(img, 6, 10), [128, 128, 128, 255]);
  assert.deepEqual(px(img, 10, 10), [255, 255, 255, 255]);
  assert.deepEqual(px(img, 5, 10), [255, 255, 255, 255]);
});

test('Fill opens on Shift+F5 and Shift+Backspace; Stroke needs a selection', () => {
  const key = (k, mods = {}) => commandForKey({ key: k, code: '', ...mods })?.id;
  assert.equal(key('F5', { shiftKey: true }), 'edit.fill');
  assert.equal(key('Backspace', { shiftKey: true }), 'edit.fill');
  const fill = COMMANDS_BY_ID.get('edit.fill'),
    stroke = COMMANDS_BY_ID.get('edit.stroke');
  assert.equal(fill.label, 'Fill…');
  assert.equal(stroke.label, 'Stroke…');
  const layers = [{}];
  const none = { layers, activeLayerIdx: 0, sel: { mode: 'none' } };
  const active = { layers, activeLayerIdx: 0, sel: { mode: 'active', w: 4, h: 4 } };
  assert.equal(fill.enabled(none), true);
  assert.equal(stroke.enabled(none), false);
  assert.equal(stroke.enabled(active), true);
  const calls = [];
  fill.run({ openFill: () => calls.push('fill') });
  stroke.run({ openStroke: () => calls.push('stroke') });
  assert.deepEqual(calls, ['fill', 'stroke']);
});
