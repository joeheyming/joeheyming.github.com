import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAddNoise, hash01, ADJUSTMENTS } from '../paint/adjustments.js';

function image(W, H, fn) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) data.set(fn(x, y), (y * W + x) * 4);
  }
  return { width: W, height: H, data };
}

function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return Array.from(img.data.slice(i, i + 4));
}

const gray = (W = 16, H = 16) => image(W, H, () => [128, 128, 128, 255]);

// Reference hash in BigInt, independent of the Math.imul implementation.
function refHash01(x, y, c, seed) {
  const M = 0xffffffffn;
  const u = (v) => BigInt(v) & M;
  const mul = (a, b) => (a * b) & M;
  let h =
    mul(u(x), 0x8da6b343n) ^
    mul(u(y), 0xd8163841n) ^
    mul(u(c), 0xcb1ab31fn) ^
    mul(u(seed), 0x9e3779b9n);
  h ^= h >> 16n;
  h = mul(h, 0x7feb352dn);
  h ^= h >> 15n;
  h = mul(h, 0x846ca68bn);
  h ^= h >> 16n;
  return Number(h >> 8n) / 2 ** 24;
}

test('addNoise is registered after median and apply dispatches', () => {
  const a = ADJUSTMENTS.addNoise;
  assert.equal(a.label, 'Add Noise');
  assert.deepEqual(
    a.fields.map((f) => [f.key, f.min, f.max, f.default]),
    [
      ['amount', 0, 400, 25],
      ['gaussian', 0, 1, 0],
      ['mono', 0, 1, 0],
      ['seed', 0, 9999, 1]
    ]
  );
  const viaApply = gray();
  a.apply(viaApply, { amount: 50, gaussian: 0, mono: 0, seed: 3 }, null);
  const direct = gray();
  applyAddNoise(direct, 50, 0, 0, 3);
  assert.deepEqual(viaApply.data, direct.data);
  assert.notDeepEqual(direct.data, gray().data);
});

test('hash01 is deterministic, in [0, 1), and matches the 32-bit reference', () => {
  for (const [x, y, c, s] of [
    [0, 0, 0, 0],
    [1, 2, 3, 4],
    [-5, 17, 101, 9999],
    [4095, 4095, 2, 1]
  ]) {
    const h = hash01(x, y, c, s);
    assert.ok(h >= 0 && h < 1, `${h}`);
    assert.equal(h, hash01(x, y, c, s));
    assert.equal(h, refHash01(x, y, c, s));
  }
  assert.equal(hash01(0, 0, 0, 0), 0);
});

test('amount 0 is a no-op', () => {
  const img = gray();
  applyAddNoise(img, 0, 0, 0, 1);
  assert.deepEqual(img.data, gray().data);
  applyAddNoise(img, 0, 1, 1, 7);
  assert.deepEqual(img.data, gray().data);
});

test('same seed reproduces, different seed changes', () => {
  for (const g of [0, 1]) {
    const a = gray(),
      b = gray(),
      c = gray();
    applyAddNoise(a, 60, g, 0, 5);
    applyAddNoise(b, 60, g, 0, 5);
    applyAddNoise(c, 60, g, 0, 6);
    assert.deepEqual(a.data, b.data);
    assert.notDeepEqual(a.data, c.data);
  }
});

test('uniform noise at amount 100 stays within +-128 levels of mid-gray', () => {
  const img = gray(32, 32);
  applyAddNoise(img, 100, 0, 0, 1);
  let spread = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const dv = Math.abs(img.data[i + c] - 128);
      assert.ok(dv <= 128, `delta ${dv}`);
      spread = Math.max(spread, dv);
    }
    assert.equal(img.data[i + 3], 255);
  }
  assert.ok(spread > 64, 'noise should use most of its range');
});

test('mono gives R = G = B on gray; color does not', () => {
  for (const g of [0, 1]) {
    const mono = gray();
    applyAddNoise(mono, 80, g, 1, 2);
    let colored = false;
    for (let i = 0; i < mono.data.length; i += 4) {
      assert.equal(mono.data[i], mono.data[i + 1]);
      assert.equal(mono.data[i], mono.data[i + 2]);
    }
    const color = gray();
    applyAddNoise(color, 80, g, 0, 2);
    for (let i = 0; i < color.data.length; i += 4) {
      if (color.data[i] !== color.data[i + 1] || color.data[i] !== color.data[i + 2])
        colored = true;
    }
    assert.ok(colored);
  }
});

test('a uniform pixel matches the formula by hand', () => {
  const img = image(8, 8, () => [100, 150, 200, 255]);
  applyAddNoise(img, 40, 0, 0, 42);
  const a = 0.4 * 0.5;
  const [x, y] = [5, 3];
  const want = [100, 150, 200].map((v, c) =>
    Math.min(255, Math.max(0, Math.round(v + (refHash01(x, y, c, 42) - 0.5) * 2 * a * 255)))
  );
  assert.deepEqual(px(img, x, y), [...want, 255]);
});

test('a gaussian pixel matches the formula by hand', () => {
  const img = image(8, 8, () => [100, 150, 200, 255]);
  applyAddNoise(img, 100, 1, 0, 9);
  const a = 0.5;
  const [x, y] = [2, 6];
  const want = [100, 150, 200].map((v, c) => {
    const u1 = Math.max(refHash01(x, y, c * 2 + 101, 9), 1e-7);
    const u2 = refHash01(x, y, c * 2 + 102, 9);
    const n = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * a * 0.5;
    return Math.min(255, Math.max(0, Math.round(v + n * 255)));
  });
  assert.deepEqual(px(img, x, y), [...want, 255]);
});

test('alpha-0 pixels are untouched and alpha is preserved', () => {
  const img = image(8, 8, (x) => (x < 4 ? [10, 20, 30, 0] : [128, 128, 128, 77]));
  applyAddNoise(img, 200, 0, 0, 1);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const p = px(img, x, y);
      if (x < 4) assert.deepEqual(p, [10, 20, 30, 0]);
      else assert.equal(p[3], 77);
    }
  }
});

test('mask limits the change without altering the noise pattern', () => {
  const W = 12,
    H = 12;
  const mask = new Uint8Array(W * H);
  for (let p = 0; p < mask.length; p++) mask[p] = p % W < 6 ? 1 : 0;
  const masked = gray(W, H);
  applyAddNoise(masked, 70, 0, 0, 11, mask);
  const full = gray(W, H);
  applyAddNoise(full, 70, 0, 0, 11);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x < 6) assert.deepEqual(px(masked, x, y), px(full, x, y));
      else assert.deepEqual(px(masked, x, y), [128, 128, 128, 255]);
    }
  }
});
