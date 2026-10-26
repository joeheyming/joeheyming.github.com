import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLiquify,
  applyLiquifyStroke,
  defaultLiquifyOptions,
  isIdentityField,
  liquifyFalloff,
  maxDisplacement,
  newLiquifyField,
  reconstructAll,
  restoreAll,
  sampleField,
  setFreezeAll
} from '../paint/liquify.js';
import { COMMANDS_BY_ID } from '../paint/commands.js';

const W = 64;
const H = 64;
const BOUNDS = { x0: 0, y0: 0, x1: W, y1: H };
const brush = (tool, extra = {}) => ({ ...defaultLiquifyOptions(), tool, size: 30, ...extra });

// White, with a black vertical stripe over x 20..23.
function stripe() {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = x >= 20 && x < 24 ? 0 : 255;
      data.set([v, v, v, 255], (y * W + x) * 4);
    }
  }
  return { width: W, height: H, data };
}
const blank = () => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4) });
const red = (img, x, y) => img.data[(y * W + x) * 4];
// Darkness-weighted mean x of row y.
function darkCentre(img, y) {
  let sum = 0;
  let wx = 0;
  for (let x = 0; x < W; x++) {
    const k = 255 - red(img, x, y);
    sum += k;
    wx += k * x;
  }
  return wx / sum;
}
const liquify = (src, field, mask) => applyLiquify(src, blank(), field, mask);

test('a zero field is the identity', () => {
  const f = newLiquifyField(BOUNDS);
  assert.ok(isIdentityField(f));
  const src = stripe();
  assert.deepEqual(liquify(src, f).data, src.data);
});

test('the dab falloff is 1 at the centre and fades to 0 at the rim', () => {
  for (const density of [0, 0.5, 1]) {
    assert.equal(liquifyFalloff(0, density), 1);
    assert.equal(liquifyFalloff(1, density), 0);
    assert.ok(liquifyFalloff(0.25, density) > liquifyFalloff(0.5, density));
  }
});

test('a Forward Warp dab moves pixels along the stroke', () => {
  const f = newLiquifyField(BOUNDS);
  applyLiquifyStroke(f, brush('forwardWarp'), [
    [22, 32],
    [32, 32]
  ]);
  assert.ok(!isIdentityField(f));
  // Inverse displacement: past the stripe the output samples back toward it (negative x).
  const [dx, dy] = sampleField(f, 28.5, 32.5);
  assert.ok(dx < -2, `dx ${dx}`);
  assert.ok(Math.abs(dy) < 0.5, `dy ${dy}`);
  const src = stripe();
  const out = liquify(src, f);
  // The stripe was dragged right along the stroke row ...
  const shift = darkCentre(out, 32) - darkCentre(src, 32);
  assert.ok(shift > 2, `shift ${shift}`);
  // The stripe's old spot now samples white from its left, and it is dark further right.
  assert.ok(red(out, 20, 32) > red(src, 20, 32));
  let darkest = 255;
  for (let x = 24; x < 44; x++) darkest = Math.min(darkest, red(out, x, 32));
  assert.ok(darkest < 128, `darkest ${darkest}`);
  // ... and stays put far from the brush.
  assert.equal(red(out, 21, 2), 0);
  assert.equal(red(out, 28, 2), 255);
  assert.equal(red(out, 60, 32), 255);
});

test('Reconstruct shrinks the field; Reconstruct All and Restore All reset it', () => {
  const f = newLiquifyField(BOUNDS);
  applyLiquifyStroke(f, brush('forwardWarp'), [
    [22, 32],
    [32, 32]
  ]);
  const before = maxDisplacement(f);
  const at = Math.hypot(...sampleField(f, 28.5, 32.5));
  applyLiquifyStroke(f, brush('reconstruct'), [
    [28, 32],
    [29, 32]
  ]);
  assert.ok(maxDisplacement(f) < before);
  assert.ok(Math.hypot(...sampleField(f, 28.5, 32.5)) < at);
  const mid = maxDisplacement(f);
  reconstructAll(f, 50);
  assert.ok(Math.abs(maxDisplacement(f) - mid / 2) < 1e-4);
  restoreAll(f);
  assert.ok(isIdentityField(f));
});

test('the freeze mask protects nodes from the brush', () => {
  const f = newLiquifyField(BOUNDS);
  setFreezeAll(f, 'all');
  applyLiquifyStroke(f, brush('forwardWarp'), [
    [22, 32],
    [32, 32]
  ]);
  assert.ok(isIdentityField(f));
  setFreezeAll(f, 'invert');
  applyLiquifyStroke(f, brush('bloat'), [[32, 32]]);
  assert.ok(!isIdentityField(f));
});

test('Pucker pulls content in and Bloat pushes it out', () => {
  const pucker = newLiquifyField(BOUNDS);
  applyLiquifyStroke(pucker, brush('pucker'), [[32, 32]]);
  const bloat = newLiquifyField(BOUNDS);
  applyLiquifyStroke(bloat, brush('bloat'), [[32, 32]]);
  // Right of the centre: Pucker samples further out (+x), Bloat closer in (−x).
  assert.ok(sampleField(pucker, 38.5, 32.5)[0] > 0);
  assert.ok(sampleField(bloat, 38.5, 32.5)[0] < 0);
  const twirl = newLiquifyField(BOUNDS);
  applyLiquifyStroke(twirl, brush('twirlCw'), [[32, 32]]);
  assert.ok(Math.abs(sampleField(twirl, 38.5, 32.5)[1]) > 0);
});

test('a selection limits the pixels Liquify writes', () => {
  const f = newLiquifyField(BOUNDS);
  applyLiquifyStroke(f, brush('forwardWarp'), [
    [22, 32],
    [32, 32]
  ]);
  const src = stripe();
  const mask = new Uint8Array(W * H);
  const out = applyLiquify(src, { width: W, height: H, data: src.data.slice() }, f, mask);
  assert.deepEqual(out.data, src.data);
});

test('Filter › Liquify… opens the Liquify workspace', () => {
  const c = COMMANDS_BY_ID.get('filter.liquify');
  assert.ok(c);
  assert.equal(c.label, 'Liquify…');
  assert.deepEqual(c.menu, ['Filter']);
  assert.equal(c.shortcut, 'Cmd+Shift+X');
  assert.equal(c.enabled({ layers: [{ id: 'a', kind: 'pixel' }], activeLayerIdx: 0 }), true);
  let opened = 0;
  c.run({ openLiquify: () => opened++ });
  assert.equal(opened, 1);
});
