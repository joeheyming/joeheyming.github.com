import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyVibrance, ADJUSTMENTS } from '../paint/adjustments.js';

function image(pixels) {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((rgb, p) => data.set([...rgb, 255], p * 4));
  return { width: pixels.length, height: 1, data };
}

function px(img, p) {
  return Array.from(img.data.slice(p * 4, p * 4 + 4));
}

// Chroma: how far apart the channels are. 0 is gray.
function spread([r, g, b]) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

test('vibrance is registered with a -100..100 amount field', () => {
  const def = ADJUSTMENTS.vibrance;
  assert.equal(def.label, 'Vibrance');
  assert.deepEqual(def.fields, [
    { key: 'amount', label: 'Amount', min: -100, max: 100, default: 0 }
  ]);
});

test('amount 0 is a no-op', () => {
  const img = image([
    [160, 120, 100],
    [255, 0, 0],
    [30, 200, 90]
  ]);
  const before = img.data.slice();
  applyVibrance(img, 0);
  assert.deepEqual(img.data, before);
});

test('a gray pixel stays gray at both ends of the range', () => {
  for (const amount of [100, -100]) {
    const img = image([
      [128, 128, 128],
      [0, 0, 0],
      [255, 255, 255]
    ]);
    applyVibrance(img, amount);
    assert.deepEqual(px(img, 0), [128, 128, 128, 255]);
    assert.deepEqual(px(img, 1), [0, 0, 0, 255]);
    assert.deepEqual(px(img, 2), [255, 255, 255, 255]);
  }
});

test('a saturated primary barely moves while a muted color moves farther', () => {
  const primary = [255, 0, 0];
  const muted = [160, 120, 100];
  const img = image([primary, muted]);
  applyVibrance(img, 100);
  const outPrimary = px(img, 0).slice(0, 3);
  const outMuted = px(img, 1).slice(0, 3);
  const moved = (a, b) => a.reduce((sum, v, c) => sum + Math.abs(v - b[c]), 0);
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(outPrimary[c] - primary[c]) <= 1);
  assert.ok(moved(outMuted, muted) > moved(outPrimary, primary));
  assert.ok(spread(outMuted) > spread(muted), 'muted color gains saturation');
  // Hue and value hold: red stays the max channel at the same level.
  assert.equal(outMuted[0], 160);
  assert.ok(outMuted[1] > outMuted[2]);
});

test('negative vibrance pulls toward gray', () => {
  const muted = [160, 120, 100];
  const img = image([muted, [255, 0, 0]]);
  applyVibrance(img, -50);
  assert.ok(spread(px(img, 0)) < spread(muted));
  assert.ok(spread(px(img, 1)) < 255);
  const gray = image([muted]);
  applyVibrance(gray, -100);
  const [r, g, b] = px(gray, 0);
  assert.equal(r, g);
  assert.equal(g, b);
});

test('pixels outside the mask are unchanged', () => {
  const img = image([
    [160, 120, 100],
    [160, 120, 100]
  ]);
  applyVibrance(img, 100, new Uint8Array([1, 0]));
  assert.notDeepEqual(px(img, 0), [160, 120, 100, 255]);
  assert.deepEqual(px(img, 1), [160, 120, 100, 255]);
});
