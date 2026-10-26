import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMezzotint, mezzotintThreshold, hash01, ADJUSTMENTS } from '../paint/adjustments.js';

// Non-square: 13 wide, 9 tall.
const W = 13;
const H = 9;

function image(fill = [0, 0, 0, 255]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) data.set(fill, p * 4);
  return { width: W, height: H, data };
}

const pxAt = (img, x, y) => Array.from(img.data.slice((y * W + x) * 4, (y * W + x) * 4 + 4));

// Every pixel distinct, with varied alpha.
function noisy() {
  const img = image();
  for (let p = 0; p < W * H; p++) {
    const v = (p * 73 + 41) % 251;
    img.data.set([v, (v * 3) % 256, (v * 7) % 256, 55 + (p % 200)], p * 4);
  }
  return img;
}

test('mezzotint is registered and dispatches type and seed', () => {
  const adj = ADJUSTMENTS.mezzotint;
  assert.equal(adj.label, 'Mezzotint');
  const type = adj.fields.find((f) => f.key === 'type');
  const seed = adj.fields.find((f) => f.key === 'seed');
  assert.deepEqual([type.min, type.max, type.default], [0, 9, 0]);
  assert.deepEqual([seed.min, seed.max, seed.default], [0, 9999, 0]);
  const a = noisy();
  const b = noisy();
  adj.apply(a, { type: 5, seed: 12 }, null);
  applyMezzotint(b, 5, 12);
  assert.deepEqual(a.data, b.data);
});

test('every type gives pure channels and keeps alpha', () => {
  const src = noisy();
  for (let t = 0; t <= 9; t++) {
    const img = noisy();
    applyMezzotint(img, t, 3);
    for (let i = 0; i < img.data.length; i += 4) {
      for (let k = 0; k < 3; k++) assert.ok(img.data[i + k] === 0 || img.data[i + k] === 255);
      assert.equal(img.data[i + 3], src.data[i + 3]);
    }
  }
});

test('Fine Dots matches a hand-checked threshold at (2, 1)', () => {
  // hash01(2, 1, k, 0) for k = 0, 1, 2.
  assert.equal(mezzotintThreshold(0, 2, 1, 0, 0), 0.5909619331359863);
  assert.equal(mezzotintThreshold(0, 2, 1, 1, 0), 0.7983518242835999);
  assert.equal(mezzotintThreshold(0, 2, 1, 2, 0), 0.7176568508148193);
  const img = image();
  // 151/255 = 0.5922 > 0.5910, 204/255 = 0.8 > 0.7984, 183/255 = 0.71765 < 0.71766.
  img.data.set([151, 204, 183, 77], (1 * W + 2) * 4);
  applyMezzotint(img, 0, 0);
  assert.deepEqual(pxAt(img, 2, 1), [255, 255, 0, 77]);
  img.data.set([150, 203, 184, 77], (1 * W + 2) * 4);
  applyMezzotint(img, 0, 0);
  assert.deepEqual(pxAt(img, 2, 1), [0, 0, 255, 77]);
});

test('Medium Dots shares a threshold across each 2x2 block', () => {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let k = 0; k < 3; k++) {
        const t = mezzotintThreshold(1, x, y, k, 9);
        assert.equal(t, hash01(x >> 1, y >> 1, k, 9));
        assert.equal(t, mezzotintThreshold(1, x & ~1, y & ~1, k, 9));
      }
    }
  }
  const img = image([128, 128, 128, 255]);
  applyMezzotint(img, 1, 9);
  for (let y = 0; y < H - 1; y += 2) {
    for (let x = 0; x < W - 1; x += 2) {
      const a = pxAt(img, x, y);
      assert.deepEqual(pxAt(img, x + 1, y), a);
      assert.deepEqual(pxAt(img, x, y + 1), a);
      assert.deepEqual(pxAt(img, x + 1, y + 1), a);
    }
  }
});

test('Grainy Dots mixes the fine and 3x3 hashes', () => {
  const t = mezzotintThreshold(2, 7, 4, 1, 2);
  const want = 0.5 * hash01(7, 4, 1, 2) + 0.5 * hash01(2, 1, 8, 2);
  assert.ok(Math.abs(t - want) < 1e-7);
});

test('Short Lines are constant along a row segment', () => {
  // Row 0, seed 0, red: phase = trunc(hash01(0, 0, 40, 0) * 6) = 1, so x = 5..10 share a segment.
  assert.equal(Math.trunc(hash01(0, 0, 40, 0) * 6), 1);
  const img = image([100, 150, 200, 255]);
  applyMezzotint(img, 4, 0);
  for (let k = 0; k < 3; k++) {
    // Each channel has its own phase from hash01(0, y, k + 40, seed).
    const phase = Math.trunc(hash01(0, 0, k + 40, 0) * 6);
    const x0 = 6 - phase;
    const t = mezzotintThreshold(4, x0, 0, k, 0);
    assert.equal(t, hash01(1, 0, k, 0));
    for (let x = x0; x < x0 + 6; x++) {
      assert.equal(mezzotintThreshold(4, x, 0, k, 0), t);
      assert.equal(img.data[x * 4 + k], img.data[x0 * 4 + k]);
    }
  }
});

test('strokes follow the diagonal formula, including negative x - y', () => {
  const x = 2;
  const y = 7;
  const d = x - y;
  const phase = Math.trunc(hash01(d, 0, 52, 4) * 10);
  assert.equal(
    mezzotintThreshold(8, x, y, 2, 4),
    hash01(Math.floor((x + y + phase) / 10), d, 62, 4)
  );
});

test('black stays black and white stays white', () => {
  for (let t = 0; t <= 9; t++) {
    const black = image([0, 0, 0, 255]);
    applyMezzotint(black, t, 5);
    assert.ok(black.data.every((v, i) => (i % 4 === 3 ? v === 255 : v === 0)));
    const white = image([255, 255, 255, 40]);
    applyMezzotint(white, t, 5);
    assert.ok(white.data.every((v, i) => (i % 4 === 3 ? v === 40 : v === 255)));
  }
});

test('a fixed seed is deterministic and another seed differs', () => {
  const a = noisy();
  const b = noisy();
  const c = noisy();
  applyMezzotint(a, 0, 42);
  applyMezzotint(b, 0, 42);
  applyMezzotint(c, 0, 43);
  assert.deepEqual(a.data, b.data);
  assert.notDeepEqual(a.data, c.data);
});

test('type and seed round and clamp', () => {
  const run = (t, s) => {
    const img = noisy();
    applyMezzotint(img, t, s);
    return img.data;
  };
  assert.deepEqual(run(3.6, 7.4), run(4, 7));
  assert.deepEqual(run(-2, -5), run(0, 0));
  assert.deepEqual(run(15, 20000), run(9, 9999));
  assert.deepEqual(run(undefined, undefined), run(0, 0));
});

test('the mask limits writes', () => {
  const src = noisy();
  const full = noisy();
  applyMezzotint(full, 0, 1);
  const mask = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p += 3) mask[p] = 1;
  const img = noisy();
  applyMezzotint(img, 0, 1, mask);
  for (let p = 0; p < W * H; p++) {
    const want = mask[p] ? full : src;
    assert.deepEqual(img.data.slice(p * 4, p * 4 + 4), want.data.slice(p * 4, p * 4 + 4));
  }
});
