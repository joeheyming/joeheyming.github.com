import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMinMax, ADJUSTMENTS } from '../paint/adjustments.js';

function image(W, H, fill) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width: W, height: H, data };
}

function clone(img) {
  return { width: img.width, height: img.height, data: img.data.slice() };
}

function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return Array.from(img.data.slice(i, i + 4));
}

function setPx(img, x, y, rgba) {
  img.data.set(rgba, (y * img.width + x) * 4);
}

// Seeded LCG noise so the comparison is deterministic.
function noisy(W, H) {
  const img = image(W, H, [0, 0, 0, 0]);
  let s = 12345;
  for (let i = 0; i < img.data.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    img.data[i] = s >>> 24;
  }
  return img;
}

// Brute-force square window; outside the image reads as 0.
function bruteMinMax(img, r, max) {
  const { width: W, height: H, data } = img;
  const out = clone(img);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let c = 0; c < 4; c++) {
        let e = max ? -1 : 256;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const sx = x + dx,
              sy = y + dy;
            const v = sx < 0 || sx >= W || sy < 0 || sy >= H ? 0 : data[(sy * W + sx) * 4 + c];
            e = max ? Math.max(e, v) : Math.min(e, v);
          }
        }
        out.data[(y * W + x) * 4 + c] = e;
      }
    }
  }
  return out;
}

const GRAY = [128, 128, 128, 255];
const WHITE = [255, 255, 255, 255];

test('maximum and minimum are registered with radius and round fields', () => {
  for (const [id, label] of [
    ['maximum', 'Maximum'],
    ['minimum', 'Minimum']
  ]) {
    const adj = ADJUSTMENTS[id];
    assert.equal(adj.label, label);
    assert.equal(typeof adj.apply, 'function');
    assert.deepEqual(
      adj.fields.map((f) => [f.key, f.default, f.min, f.max]),
      [
        ['radius', 1, 1, 100],
        ['round', 0, 0, 1]
      ]
    );
  }
});

test('radius 0 leaves the image unchanged', () => {
  const img = noisy(12, 9);
  const before = img.data.slice();
  applyMinMax(img, 0, true);
  applyMinMax(img, 0, false);
  assert.deepEqual(img.data, before);
});

test('PhotoCraft minimum_maximum_spread: a white speck on gray', () => {
  const src = image(30, 30, GRAY);
  setPx(src, 10, 10, WHITE);
  const mx = clone(src);
  applyMinMax(mx, 1, true);
  assert.deepEqual(px(mx, 11, 11), WHITE);
  assert.deepEqual(px(mx, 12, 10), GRAY);
  const mn = clone(src);
  applyMinMax(mn, 1, false);
  assert.deepEqual(px(mn, 10, 10), GRAY);
});

test('matches a brute-force square window at r = 1, 2, 5, borders included', () => {
  const src = noisy(23, 17);
  for (const r of [1, 2, 5]) {
    for (const max of [true, false]) {
      const got = clone(src);
      applyMinMax(got, r, max);
      assert.deepEqual(got.data, bruteMinMax(src, r, max).data, `r ${r} max ${max}`);
    }
  }
});

test('radius 50 on 256x256 finishes in under 2 seconds', () => {
  const img = noisy(256, 256);
  const t0 = performance.now();
  applyMinMax(img, 50, true);
  applyMinMax(img, 50, false);
  assert.ok(performance.now() - t0 < 2000);
});

test('mask limits writes; masked-out pixels are still sampled', () => {
  const src = image(8, 8, GRAY);
  setPx(src, 3, 3, WHITE);
  const mask = new Uint8Array(64);
  mask[3 * 8 + 4] = 1;
  const img = clone(src);
  applyMinMax(img, 1, true, mask);
  assert.deepEqual(px(img, 4, 3), WHITE);
  assert.deepEqual(px(img, 2, 3), GRAY);
  assert.deepEqual(px(img, 3, 4), GRAY);
  for (let p = 0; p < 64; p++) {
    if (p === 3 * 8 + 4) continue;
    const x = p % 8,
      y = (p / 8) | 0;
    assert.deepEqual(px(img, x, y), px(src, x, y));
  }
});
