import test from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, antialiasCoverage, bucketFillImage } from '../paint/tools.js';

function strip(pixels) {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((rgba, i) => data.set(rgba, i * 4));
  return { width: pixels.length, height: 1, data };
}

function ctxFor(img) {
  return {
    canvas: { width: img.width, height: img.height },
    getImageData: () => ({ width: img.width, height: img.height, data: img.data.slice() }),
    putImageData(next) {
      img.data.set(next.data);
    }
  };
}

const px = (img, i) => Array.from(img.data.slice(i * 4, i * 4 + 4));
const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];

function fillAt(img, x, antiAlias, extra = {}) {
  const state = {
    activeColor: '#ff0000',
    color: '#ff0000',
    toolOptions: {
      fill: { opacity: 100, tolerance: 0, contiguous: true, antiAlias, fillSource: 'foreground' }
    },
    ...extra
  };
  TOOLS.fill.onDown(ctxFor(img), null, state, x, 0);
}

test('antialiasCoverage ports PhotoCraft selection.rs antialias on a 4 x 1 strip', () => {
  const cov = antialiasCoverage(Uint8Array.from([1, 1, 0, 0]), 4, 1);
  assert.ok(cov instanceof Float32Array);
  assert.equal(cov[0], 1);
  assert.equal(cov[1], Math.fround(0.5 + (0.5 * 8) / 9));
  assert.equal(cov[2], Math.fround((0.5 * 1) / 9));
  assert.equal(cov[3], 0);
});

test('bucketFillImage with a 0/1 Uint8Array region keeps the hard-edged composite', () => {
  const img = strip([WHITE, WHITE, BLACK]);
  bucketFillImage(img, Uint8Array.from([1, 1, 0]), '#ff0000', 50);
  assert.deepEqual(px(img, 0), [255, 128, 128, 255]);
  assert.deepEqual(px(img, 2), BLACK);
});

test('Anti-alias off leaves the fill hard-edged as in US-131', () => {
  const img = strip([WHITE, WHITE, BLACK, BLACK]);
  fillAt(img, 0, false);
  assert.deepEqual(px(img, 0), [255, 0, 0, 255]);
  assert.deepEqual(px(img, 1), [255, 0, 0, 255]);
  assert.deepEqual(px(img, 2), BLACK);
  assert.deepEqual(px(img, 3), BLACK);
});

test('Anti-alias on partially blends the pixel just outside the matched region', () => {
  const img = strip([WHITE, WHITE, BLACK, BLACK]);
  fillAt(img, 0, true);
  assert.deepEqual(px(img, 0), [255, 0, 0, 255]);
  const k = 0.5 / 9;
  assert.deepEqual(px(img, 2), [Math.round(255 * k), 0, 0, 255]);
  assert.ok(px(img, 2)[0] > 0 && px(img, 2)[0] < 255);
  assert.deepEqual(px(img, 3), BLACK);
  // x = 1 is selected but on the edge, so it keeps a trace of white.
  const c1 = 0.5 + (0.5 * 8) / 9;
  assert.deepEqual(px(img, 1), [255, Math.round(255 * (1 - c1)), Math.round(255 * (1 - c1)), 255]);
});

test('Anti-alias fringe never reaches pixels outside an active selection', () => {
  const img = strip([WHITE, WHITE, WHITE, BLACK]);
  const sel = { mode: 'active', x: 0, y: 0, w: 2, h: 1, mask: Uint8Array.from([1, 1]) };
  fillAt(img, 0, true, { sel });
  assert.deepEqual(px(img, 2), WHITE);
  assert.deepEqual(px(img, 3), BLACK);
  assert.equal(px(img, 0)[0], 255);
});
