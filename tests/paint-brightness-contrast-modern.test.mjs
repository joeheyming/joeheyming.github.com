import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADJUSTMENTS,
  applyLegacyBrightnessContrast,
  applyModernBrightnessContrast,
  modernBrightness,
  modernContrast
} from '../paint/adjustments.js';

const XS = [0, 16, 32, 64, 96, 128, 160, 192, 224, 255];

const px = (...rgba) => ({ width: rgba.length / 4, height: 1, data: new Uint8ClampedArray(rgba) });

function assertRow(fn, value, want, tol) {
  XS.forEach((x, i) => {
    const got = fn(x / 255, value) * 255;
    assert.ok(
      Math.abs(got - want[i]) <= tol,
      `${fn.name} ${value} x=${x}: got ${got.toFixed(2)} want ${want[i]}`
    );
  });
}

test('modernContrast matches the Photoshop reference rows', () => {
  assertRow(modernContrast, 50, [0, 11, 23, 52, 87, 128, 169, 204, 233, 255], 2);
  assertRow(modernContrast, -50, [0, 21, 41, 76, 105, 128, 151, 180, 215, 255], 2);
  for (const c of [-50, 0, 50, 100]) {
    assert.equal(modernContrast(0, c), 0);
    assert.ok(Math.abs(modernContrast(0.5, c) - 0.5) < 1e-12);
    assert.ok(Math.abs(modernContrast(1, c) - 1) < 1e-12);
  }
});

test('modernBrightness matches the Photoshop reference rows', () => {
  assertRow(modernBrightness, 50, [0, 22, 44, 88, 132, 171, 203, 228, 246, 255], 1.2);
  assertRow(modernBrightness, -50, [0, 12, 23, 47, 70, 93, 118, 148, 186, 255], 1.2);
});

test('brightness 0 and contrast 0 are the identity', () => {
  for (let x = 0; x <= 255; x++) {
    assert.equal(modernBrightness(x / 255, 0), x / 255);
    assert.equal(modernContrast(x / 255, 0), x / 255);
  }
  const data = [];
  for (let v = 0; v < 256; v++) data.push(v, 255 - v, v, 255);
  const img = px(...data);
  applyModernBrightnessContrast(img, 0, 0);
  assert.deepEqual([...img.data], data);
});

test('modernBrightness stays monotone in 0..1 over the slider range', () => {
  for (let b = -150; b <= 150; b += 25) {
    let prev = 0;
    for (let k = 0; k <= 1020; k++) {
      const v = modernBrightness(k / 1020, b);
      assert.ok(v >= 0 && v <= 1 && v >= prev - 1e-6, `brightness ${b} at ${k}/1020: ${v}`);
      prev = v;
    }
    assert.ok(Math.abs(modernBrightness(1, b) - 1) < 1e-5);
    assert.ok(Math.abs(modernBrightness(0, b)) < 1e-5);
  }
});

test('modern apply leaves alpha, transparent and masked-out pixels alone', () => {
  const img = px(100, 100, 100, 77, 0, 0, 0, 0, 50, 60, 70, 255);
  applyModernBrightnessContrast(img, 60, 20, new Uint8Array([1, 1, 0]));
  const want = Math.round(modernContrast(modernBrightness(100 / 255, 60), 20) * 255);
  assert.ok(want > 100);
  assert.deepEqual([...img.data], [want, want, want, 77, 0, 0, 0, 0, 50, 60, 70, 255]);
});

test('modern apply floors contrast at -50', () => {
  const a = px(40, 90, 200, 255);
  const b = px(40, 90, 200, 255);
  applyModernBrightnessContrast(a, 10, -100);
  applyModernBrightnessContrast(b, 10, -50);
  assert.deepEqual([...a.data], [...b.data]);
});

test('apply switches between legacy and modern on params.legacy', () => {
  const params = { brightness: 40, contrast: 30 };
  const source = [128, 128, 128, 255, 30, 200, 90, 255];

  const legacy = px(...source);
  ADJUSTMENTS.brightness.apply(legacy, { ...params, legacy: true }, null);
  const legacyWant = px(...source);
  applyLegacyBrightnessContrast(legacyWant, 40, 30);
  assert.deepEqual([...legacy.data], [...legacyWant.data]);
  assert.deepEqual([...legacy.data.slice(0, 4)], [185, 185, 185, 255]);

  const modern = px(...source);
  ADJUSTMENTS.brightness.apply(modern, { ...params, legacy: false }, null);
  const modernWant = px(...source);
  applyModernBrightnessContrast(modernWant, 40, 30);
  assert.deepEqual([...modern.data], [...modernWant.data]);
  assert.notDeepEqual([...modern.data], [...legacy.data]);

  const missing = px(...source);
  ADJUSTMENTS.brightness.apply(missing, params, null);
  assert.deepEqual([...missing.data], [...modernWant.data]);
});
