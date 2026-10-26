// Shared fixtures for paint/ node:test suites.
// Prefer these over copy-pasted makeImage / px helpers in each story file.

import assert from 'node:assert/strict';

/**
 * ImageData-shaped buffer filled with one RGBA (default transparent).
 * @param {number} W
 * @param {number} H
 * @param {number[]} [rgba]
 */
export function makeImage(W, H, rgba = [0, 0, 0, 0]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width: W, height: H, data };
}

/**
 * Image from a length-W*H list of [r,g,b,a] pixels (row-major).
 * @param {number[][]} pixels
 * @param {number} [w]
 * @param {number} [h]
 */
export function imageFromPixels(pixels, w, h) {
  const width = w ?? pixels.length;
  const height = h ?? Math.max(1, Math.floor(pixels.length / width));
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach((p, i) => data.set(p, i * 4));
  return { width, height, data };
}

/**
 * Image where every pixel is `fill` ([r,g,b,a]).
 * @param {number} W
 * @param {number} H
 * @param {number[]} fill
 */
export function imageFilled(W, H, fill) {
  return makeImage(W, H, fill);
}

/**
 * Image from `(x, y) => [r,g,b,a]`.
 * @param {number} W
 * @param {number} H
 * @param {(x: number, y: number) => number[]} fn
 */
export function imageFromFn(W, H, fn) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) data.set(fn(x, y), (y * W + x) * 4);
  }
  return { width: W, height: H, data };
}

/** RGBA at pixel index `p` (row-major). */
export function pxAt(img, p) {
  return Array.from(img.data.slice(p * 4, p * 4 + 4));
}

/** RGBA at (x, y). */
export function px(img, x, y) {
  return pxAt(img, y * img.width + x);
}

/**
 * Assert each channel of `actual` is within `tol` of `expected`.
 * @param {number[]} actual
 * @param {number[]} expected
 * @param {number} tol
 * @param {string} [msg]
 */
export function near(actual, expected, tol, msg = 'near') {
  actual.forEach((v, k) =>
    assert.ok(Math.abs(v - expected[k]) <= tol, `${msg}: ${actual} vs ${expected}`)
  );
}
