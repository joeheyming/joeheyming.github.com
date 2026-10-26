import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADJUSTMENTS,
  applyConvolve3,
  applyGaussianBlur,
  applyUnsharpMask
} from '../paint/adjustments.js';

const W = 9,
  H = 7;

function image(fill, w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width: w, height: h, data };
}

function clone(img) {
  return { width: img.width, height: img.height, data: img.data.slice() };
}

function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return Array.from(img.data.slice(i, i + 4));
}

function impulse() {
  const img = image([0, 0, 0, 255]);
  img.data.set([255, 255, 255, 255], (3 * W + 4) * 4);
  return img;
}

function noisy() {
  const img = image([0, 0, 0, 255]);
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    img.data[i] = (p * 37) % 256;
    img.data[i + 1] = (p * 91 + 13) % 256;
    img.data[i + 2] = (p * 53 + 200) % 256;
  }
  return img;
}

const PRESETS = [
  ['blur', 'Blur'],
  ['blurMore', 'Blur More'],
  ['sharpenMore', 'Sharpen More'],
  ['sharpenEdges', 'Sharpen Edges']
];

test('the four presets are registered with no fields and dispatch', () => {
  for (const [id, label] of PRESETS) {
    const def = ADJUSTMENTS[id];
    assert.equal(def.label, label, id);
    assert.deepEqual(def.fields, [], id);
    const img = noisy();
    const before = img.data.slice();
    def.apply(img, {}, null);
    assert.notDeepEqual(img.data, before, `${id} changes a noisy image`);
  }
  const a = noisy();
  ADJUSTMENTS.blur.apply(a, {}, null);
  const b = noisy();
  applyGaussianBlur(b, 0.6);
  assert.deepEqual(a.data, b.data, 'blur is Gaussian 0.6');
  const c = noisy();
  ADJUSTMENTS.blurMore.apply(c, {}, null);
  const e = noisy();
  applyConvolve3(e, [1, 2, 1, 2, 2, 2, 1, 2, 1], 14, 0);
  assert.deepEqual(c.data, e.data, 'blurMore is the /14 kernel');
});

test('the Gaussian Blur dialog still starts at radius 1', () => {
  assert.equal(ADJUSTMENTS.gaussianBlur.fields[0].min, 1);
});

test('a flat image is unchanged by each preset', () => {
  for (const [id] of PRESETS) {
    const img = image([40, 120, 200, 255]);
    const before = img.data.slice();
    ADJUSTMENTS[id].apply(img, {}, null);
    assert.deepEqual(img.data, before, id);
  }
});

test('Blur More of a single white pixel is the kernel / 14', () => {
  const img = impulse();
  ADJUSTMENTS.blurMore.apply(img, {}, null);
  const k = [
    [1, 2, 1],
    [2, 2, 2],
    [1, 2, 1]
  ];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - 4,
        dy = y - 3;
      const w = Math.abs(dx) <= 1 && Math.abs(dy) <= 1 ? k[dy + 1][dx + 1] : 0;
      const v = Math.round((w * 255) / 14);
      assert.deepEqual(px(img, x, y), [v, v, v, 255], `(${x}, ${y})`);
    }
  }
});

test('Blur matches hand-computed sigma 0.6 Gaussian pixels', () => {
  const g = [-2, -1, 0, 1, 2].map((i) => Math.exp(-(i * i) / (2 * 0.6 * 0.6)));
  const sum = g.reduce((s, v) => s + v, 0);
  const k = g.map((v) => v / sum);
  const img = impulse();
  ADJUSTMENTS.blur.apply(img, {}, null);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - 4,
        dy = y - 3;
      const w = Math.abs(dx) <= 2 && Math.abs(dy) <= 2 ? k[dx + 2] * k[dy + 2] : 0;
      const v = Math.round(255 * w);
      assert.deepEqual(px(img, x, y), [v, v, v, 255], `(${x}, ${y})`);
    }
  }
  assert.equal(px(img, 4, 3)[0], 112);
  assert.equal(px(img, 5, 3)[0], 28);
});

test('a sigma below 0.05 is the identity', () => {
  for (const sigma of [0.04, 0, -1]) {
    const img = noisy();
    img.data[3] = 100;
    img.data[7] = 0;
    const before = img.data.slice();
    applyGaussianBlur(img, sigma);
    assert.deepEqual(img.data, before, `sigma ${sigma}`);
  }
  const img = impulse();
  applyGaussianBlur(img, 0.3);
  assert.ok(px(img, 4, 3)[0] < 255, 'sigma 0.3 already blurs');
});

test('Sharpen More and Sharpen Edges equal Unsharp Mask with their presets', () => {
  const cases = [
    ['sharpenMore', 150, 0.6, 0],
    ['sharpenEdges', 100, 0.8, 6]
  ];
  for (const [id, amount, radius, threshold] of cases) {
    const a = noisy();
    ADJUSTMENTS[id].apply(a, {}, null);
    const b = noisy();
    applyUnsharpMask(b, amount, radius, threshold);
    assert.deepEqual(a.data, b.data, id);
  }
});

test('Sharpen Edges leaves a low-contrast ramp under its threshold unchanged', () => {
  const img = image([0, 0, 0, 255]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      img.data.set([100 + x, 80 + y, 60 + x + y, 255], (y * W + x) * 4);
    }
  }
  const before = img.data.slice();
  ADJUSTMENTS.sharpenEdges.apply(img, {}, null);
  assert.deepEqual(img.data, before);
  // The same ramp with one bump of 10 crosses the threshold at the bump.
  img.data[(3 * W + 4) * 4] += 10;
  ADJUSTMENTS.sharpenEdges.apply(img, {}, null);
  assert.ok(img.data[(3 * W + 4) * 4] > before[(3 * W + 4) * 4] + 10, 'bump sharpened');
});

test('applyConvolve3 repeats edges, keeps alpha, treats scale 0 as 1, adds offset', () => {
  const img = noisy();
  img.data[3] = 77;
  const src = clone(img);
  // Single tap at the top-left: each pixel copies its up-left neighbour, clamped.
  applyConvolve3(img, [1, 0, 0, 0, 0, 0, 0, 0, 0], 0, 10);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = px(src, Math.max(0, x - 1), Math.max(0, y - 1));
      const o = px(img, x, y);
      for (let c = 0; c < 3; c++) assert.equal(o[c], Math.min(255, s[c] + 10));
      assert.equal(o[3], px(src, x, y)[3], 'alpha kept');
    }
  }
});

for (const [id] of PRESETS) {
  test(`${id} writes only inside the mask`, () => {
    const full = noisy();
    ADJUSTMENTS[id].apply(full, {}, null);
    const img = noisy();
    const before = img.data.slice();
    const mask = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p += 2) mask[p] = 1;
    ADJUSTMENTS[id].apply(img, {}, mask);
    for (let p = 0; p < W * H; p++) {
      const src = mask[p] ? full.data : before;
      assert.deepEqual(
        Array.from(img.data.slice(p * 4, p * 4 + 4)),
        Array.from(src.slice(p * 4, p * 4 + 4)),
        `p ${p}`
      );
    }
  });
}
