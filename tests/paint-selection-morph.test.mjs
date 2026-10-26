import test from 'node:test';
import assert from 'node:assert/strict';

import { expandMask, contractMask } from '../paint/selection.js';

function blockMask(W, H, x0, y0, x1, y1) {
  const mask = new Uint8Array(W * H);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) mask[y * W + x] = 1;
  }
  return mask;
}

function selected(mask, W) {
  const out = [];
  for (let p = 0; p < mask.length; p++) if (mask[p]) out.push([p % W, Math.floor(p / W)]);
  return out;
}

test('radius 0 returns an equal copy for expand and contract', () => {
  const W = 9,
    H = 7;
  const mask = blockMask(W, H, 2, 2, 6, 5);
  for (const fn of [expandMask, contractMask]) {
    const out = fn(mask, W, H, 0);
    assert.notEqual(out, mask);
    assert.deepEqual(out, mask);
  }
});

test('expanding a single pixel by 1 adds its orthogonal neighbors only', () => {
  const W = 7,
    H = 7;
  const mask = new Uint8Array(W * H);
  mask[3 * W + 3] = 1;
  const out = expandMask(mask, W, H, 1);
  assert.deepEqual(
    selected(out, W).sort(),
    [
      [2, 3],
      [3, 2],
      [3, 3],
      [3, 4],
      [4, 3]
    ].sort()
  );
  const back = contractMask(out, W, H, 1);
  assert.equal(back[3 * W + 3], 1);
  assert.equal(
    back.reduce((a, b) => a + b, 0),
    1
  );
});

test('expand uses a circular neighborhood', () => {
  const W = 21,
    H = 21;
  const mask = new Uint8Array(W * H);
  mask[10 * W + 10] = 1;
  const out = expandMask(mask, W, H, 5);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d2 = (x - 10) ** 2 + (y - 10) ** 2;
      assert.equal(out[y * W + x], d2 <= 25 ? 1 : 0, `pixel ${x},${y}`);
    }
  }
});

test('expand and contract move a block edge by the radius', () => {
  const W = 30,
    H = 30;
  const mask = blockMask(W, H, 10, 10, 20, 20);
  const grown = expandMask(mask, W, H, 3);
  assert.equal(grown[15 * W + 7], 1);
  assert.equal(grown[15 * W + 6], 0);
  assert.equal(grown[15 * W + 22], 1);
  assert.equal(grown[15 * W + 23], 0);
  // Corner rounds: (7,7) is sqrt(18) > 3 from (10,10).
  assert.equal(grown[7 * W + 7], 0);

  const shrunk = contractMask(mask, W, H, 3);
  assert.deepEqual(shrunk, blockMask(W, H, 13, 13, 17, 17));
});

test('contract does not treat the canvas edge as unselected', () => {
  const W = 8,
    H = 6;
  const all = new Uint8Array(W * H).fill(1);
  assert.deepEqual(contractMask(all, W, H, 2), all);
});

test('radius is clamped to 0..64', () => {
  const W = 200,
    H = 3;
  const mask = new Uint8Array(W * H);
  mask[1 * W + 0] = 1;
  const out = expandMask(mask, W, H, 500);
  assert.equal(out[1 * W + 64], 1);
  assert.equal(out[1 * W + 65], 0);
  assert.deepEqual(expandMask(mask, W, H, -4), mask);
});

test('expand and contract stay fast at radius 64', () => {
  const W = 512,
    H = 512;
  const mask = blockMask(W, H, 100, 100, 400, 400);
  const t0 = performance.now();
  expandMask(mask, W, H, 64);
  contractMask(mask, W, H, 64);
  assert.ok(performance.now() - t0 < 1000);
});
