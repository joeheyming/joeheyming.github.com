import test from 'node:test';
import assert from 'node:assert/strict';

import { COMMANDS_BY_ID, FILTER_IDS } from '../paint/commands.js';
import {
  ADJUSTMENTS,
  applyCustom,
  applyHsbHsl,
  applyLensBlur,
  hsbFromRgb,
  hslFromRgb,
  rgbFromHsb,
  rgbFromHsl
} from '../paint/adjustments.js';

const W = 20,
  H = 16;

function image() {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      data[i] = (x * 37 + y * 11) % 256;
      data[i + 1] = (x * 5 + y * 23) % 256;
      data[i + 2] = x < W / 2 ? 30 : 220;
      data[i + 3] = y === 4 ? 128 : 255;
    }
  }
  return { width: W, height: H, data };
}

const clone = (img) => ({ width: img.width, height: img.height, data: img.data.slice() });

function leftHalf() {
  const mask = new Uint8Array(W * H);
  for (let p = 0; p < mask.length; p++) mask[p] = p % W < W / 2 ? 1 : 0;
  return mask;
}

const outsideUnchanged = (before, after, mask) =>
  [...after.data].every((v, i) => mask[i >> 2] || v === before.data[i]);
const changedInside = (before, after, mask) =>
  [...after.data].some((v, i) => mask[i >> 2] && v !== before.data[i]);

test('Lens Blur, Custom, and HSB/HSL sit in PhotoCraft’s Filter submenus', () => {
  const rows = [
    ['filter.blur.lensBlur', 'Blur', 'Lens Blur…', 'lensBlur'],
    ['filter.other.custom', 'Other', 'Custom…', 'custom'],
    ['filter.other.hsbHsl', 'Other', 'HSB/HSL', 'hsbHsl']
  ];
  for (const [id, sub, label, adj] of rows) {
    const cmd = COMMANDS_BY_ID.get(id);
    assert.ok(cmd, id);
    assert.equal(cmd.menu[0], 'Filter');
    assert.match(cmd.menu[1], new RegExp('^' + sub));
    assert.equal(cmd.label, label);
    assert.ok(ADJUSTMENTS[adj], adj);
    assert.ok(FILTER_IDS.has(adj));
    const opened = [];
    cmd.run({ openAdjust: (a) => opened.push(a) });
    assert.deepEqual(opened, [adj]);
  }
});

test('Custom with the identity kernel is the identity, and the default dialog is too', () => {
  const src = image();
  const kernel = Array.from({ length: 25 }, (_, i) => (i === 12 ? 1 : 0));
  const out = clone(src);
  applyCustom(out, kernel, 1, 0);
  assert.deepEqual(out.data, src.data);

  const viaRegistry = clone(src);
  const params = {};
  for (const f of ADJUSTMENTS.custom.fields) params[f.key] = f.default;
  ADJUSTMENTS.custom.apply(viaRegistry, params, null);
  assert.deepEqual(viaRegistry.data, src.data);
});

test('Custom shifts by a kernel tap, applies scale and offset, keeps alpha, honors the mask', () => {
  const src = image();
  // Tap at row 3, column 4 (dx = +1) reads the right neighbour.
  const shift = Array.from({ length: 25 }, (_, i) => (i === 13 ? 1 : 0));
  const out = clone(src);
  applyCustom(out, shift, 1, 0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const j = (y * W + Math.min(W - 1, x + 1)) * 4;
      assert.equal(out.data[i], src.data[j]);
      assert.equal(out.data[i + 3], src.data[i + 3]);
    }
  }
  const scaled = clone(src);
  const two = Array.from({ length: 25 }, (_, i) => (i === 12 ? 2 : 0));
  applyCustom(scaled, two, 2, 10);
  for (let i = 0; i < src.data.length; i += 4) {
    assert.equal(scaled.data[i], Math.min(255, src.data[i] + 10));
  }
  const mask = leftHalf();
  const masked = clone(src);
  applyCustom(masked, shift, 1, 40, mask);
  assert.ok(outsideUnchanged(src, masked, mask));
  assert.ok(changedInside(src, masked, mask));
});

test('HSB and HSL round-trip through RGB', () => {
  for (let r = 0; r <= 255; r += 51) {
    for (let g = 0; g <= 255; g += 51) {
      for (let b = 0; b <= 255; b += 51) {
        const c = [r / 255, g / 255, b / 255];
        for (const [enc, dec] of [
          [hsbFromRgb, rgbFromHsb],
          [hslFromRgb, rgbFromHsl]
        ]) {
          const back = dec(enc(c));
          for (let k = 0; k < 3; k++) assert.ok(Math.abs(back[k] - c[k]) < 1e-9, `${r},${g},${b}`);
        }
      }
    }
  }
  assert.deepEqual(hsbFromRgb([1, 0, 0]), [0, 1, 1]);
  assert.deepEqual(hslFromRgb([0, 0, 1]), [2 / 3, 1, 0.5]);

  const src = image();
  for (const model of ['hsb', 'hsl']) {
    const img = clone(src);
    applyHsbHsl(img, 'rgb', model);
    assert.notDeepEqual(img.data, src.data);
    applyHsbHsl(img, model, 'rgb');
    for (let i = 0; i < src.data.length; i++) {
      assert.ok(Math.abs(img.data[i] - src.data[i]) <= 8, `${model} byte ${i}`);
    }
  }
  const same = clone(src);
  applyHsbHsl(same, 'hsb', 'hsb');
  assert.deepEqual(same.data, src.data);

  const mask = leftHalf();
  const masked = clone(src);
  ADJUSTMENTS.hsbHsl.apply(masked, { inputMode: 'rgb', rowOrder: 'hsb' }, mask);
  assert.ok(outsideUnchanged(src, masked, mask));
  assert.ok(changedInside(src, masked, mask));
});

test('Lens Blur averages over the iris, keeps a flat image, and honors the mask', () => {
  const flatImg = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(90) };
  for (let i = 3; i < flatImg.data.length; i += 4) flatImg.data[i] = 255;
  const f = clone(flatImg);
  applyLensBlur(f, { radius: 6 });
  assert.deepEqual(f.data, flatImg.data);

  // A single bright dot spreads into the iris and keeps its total energy roughly.
  const dot = clone(flatImg);
  dot.data.fill(0);
  for (let i = 3; i < dot.data.length; i += 4) dot.data[i] = 255;
  const c = (8 * W + 10) * 4;
  dot.data[c] = dot.data[c + 1] = dot.data[c + 2] = 255;
  const blurred = clone(dot);
  applyLensBlur(blurred, { radius: 3, shape: 'hexagon' });
  assert.ok(blurred.data[c] < 255);
  assert.ok(blurred.data[c + 4] > 0 && blurred.data[c - W * 4] > 0);

  // Specular highlights bloom brighter than a plain blur.
  const bright = clone(dot);
  applyLensBlur(bright, { radius: 3, brightness: 100, threshold: 200 });
  assert.ok(bright.data[c] > blurred.data[c]);

  const src = image();
  const mask = leftHalf();
  const masked = clone(src);
  ADJUSTMENTS.lensBlur.apply(masked, { radius: 4 }, mask);
  assert.ok(outsideUnchanged(src, masked, mask));
  assert.ok(changedInside(src, masked, mask));

  // Radius 0 is the identity.
  const zero = clone(src);
  applyLensBlur(zero, { radius: 0 });
  assert.deepEqual(zero.data, src.data);
});

test('Lens Blur with a layer-mask depth map keeps the focal plane sharp', () => {
  const src = image();
  // Depth 0 (the focal plane at distance 0) on the left, 255 on the right.
  const depth = new Uint8Array(W * H);
  for (let p = 0; p < depth.length; p++) depth[p] = p % W < W / 2 ? 0 : 255;
  const out = clone(src);
  applyLensBlur(out, { radius: 5, depthMap: 'layerMask', focalDistance: 0 }, null, depth);
  const left = new Uint8Array(W * H).map((_, p) => (p % W < W / 2 ? 1 : 0));
  const right = left.map((v) => 1 - v);
  assert.ok(outsideUnchanged(src, out, right), 'focal plane unchanged');
  assert.ok(changedInside(src, out, right), 'far plane blurred');

  // Invert flips which side is in focus.
  const inv = clone(src);
  applyLensBlur(inv, { radius: 5, depthMap: 'layerMask', invert: true }, null, depth);
  assert.ok(outsideUnchanged(src, inv, left));
  assert.ok(changedInside(src, inv, left));
});
