import test from 'node:test';
import assert from 'node:assert/strict';

import { featherMask } from '../paint/selection.js';

function blockMask(W, H, x0, y0, x1, y1) {
  const mask = new Uint8Array(W * H);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) mask[y * W + x] = 1;
  }
  return mask;
}

test('featherMask radius 0 returns an equal copy', () => {
  const W = 16,
    H = 12;
  const mask = blockMask(W, H, 4, 3, 10, 9);
  const out = featherMask(mask, W, H, 0);
  assert.notEqual(out, mask);
  assert.deepEqual(out, mask);
  out[0] = 1;
  assert.equal(mask[0], 0);
});

test('featherMask keeps the W*H length and 0/1 values', () => {
  const W = 23,
    H = 17;
  const out = featherMask(blockMask(W, H, 5, 5, 12, 10), W, H, 3);
  assert.ok(out instanceof Uint8Array);
  assert.equal(out.length, W * H);
  for (const v of out) assert.ok(v === 0 || v === 1);
});

test('featherMask by 2 grows a solid block and keeps its interior', () => {
  const W = 32,
    H = 32;
  const mask = blockMask(W, H, 10, 10, 20, 20);
  const out = featherMask(mask, W, H, 2);
  for (let p = 0; p < mask.length; p++) {
    if (mask[p]) assert.equal(out[p], 1, `interior pixel ${p}`);
  }
  // Direct neighbors just past each edge become selected.
  assert.equal(out[15 * W + 9], 1);
  assert.equal(out[15 * W + 20], 1);
  assert.equal(out[9 * W + 15], 1);
  assert.equal(out[20 * W + 15], 1);
  let grown = 0;
  for (let p = 0; p < out.length; p++) grown += out[p] - mask[p];
  assert.ok(grown > 0);
  // Growth stays near the edge.
  assert.equal(out[15 * W + 6], 0);
  assert.equal(out[0], 0);
});

test('featherMask with a radius larger than the canvas does not throw', () => {
  const W = 8,
    H = 6;
  const mask = blockMask(W, H, 3, 2, 5, 4);
  const out = featherMask(mask, W, H, 500);
  assert.equal(out.length, W * H);
  for (let p = 0; p < mask.length; p++) if (mask[p]) assert.equal(out[p], 1);
  assert.deepEqual(featherMask(new Uint8Array(W * H), W, H, 500), new Uint8Array(W * H));
});
