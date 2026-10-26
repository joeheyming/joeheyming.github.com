import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTraceContour, ADJUSTMENTS } from '../paint/adjustments.js';

// Non-square on purpose.
const W = 7;
const H = 4;

function image(fn, w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data.set(fn(x, y), (y * w + x) * 4);
  }
  return { width: w, height: h, data };
}

function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return Array.from(img.data.slice(i, i + 4));
}

// A vertical step: columns 0..2 dark, 3..6 bright, in every channel, with varied alpha.
const step = (x, y) => (x < 3 ? [50, 60, 70, 200 + y] : [200, 210, 220, 100 + y]);

// The RGB of every pixel in column-major order of x, for column-wise checks.
function columns(img) {
  const out = [];
  for (let x = 0; x < img.width; x++) {
    for (let y = 0; y < img.height; y++) out.push([x, px(img, x, y).slice(0, 3)]);
  }
  return out;
}

test('trace contour: registry fields and apply dispatch', () => {
  const adj = ADJUSTMENTS.traceContour;
  assert.equal(adj.label, 'Trace Contour');
  assert.deepEqual(adj.fields, [
    { key: 'level', label: 'Level', min: 0, max: 255, default: 128 },
    { key: 'edge', label: 'Edge', min: 0, max: 1, default: 0 }
  ]);
  const a = image(step);
  const b = image(step);
  adj.apply(a, { level: 100, edge: 1 }, null);
  applyTraceContour(b, 100, 1);
  assert.deepEqual(a.data, b.data);
  const mask = new Uint8Array(W * H);
  mask[2] = 1;
  const c = image(step);
  adj.apply(c, { level: 128, edge: 0 }, mask);
  assert.deepEqual(px(c, 2, 0), [0, 0, 0, 200]);
  assert.deepEqual(px(c, 1, 0), [50, 60, 70, 200]);
});

test('trace contour: a flat image becomes all-255 RGB with alpha kept', () => {
  for (const edge of [0, 1]) {
    for (const v of [0, 100, 128, 200, 255]) {
      const img = image((x, y) => [v, v, v, 10 * x + y]);
      applyTraceContour(img, 128, edge);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) assert.deepEqual(px(img, x, y), [255, 255, 255, 10 * x + y]);
      }
    }
  }
});

test('trace contour: Lower draws on the dark side, Upper on the bright side', () => {
  const lower = image(step);
  applyTraceContour(lower, 128, 0);
  for (const [x, rgb] of columns(lower)) {
    assert.deepEqual(rgb, x === 2 ? [0, 0, 0] : [255, 255, 255], `lower x=${x}`);
  }
  const upper = image(step);
  applyTraceContour(upper, 128, 1);
  for (const [x, rgb] of columns(upper)) {
    assert.deepEqual(rgb, x === 3 ? [0, 0, 0] : [255, 255, 255], `upper x=${x}`);
  }
  // Alpha untouched.
  assert.equal(px(upper, 3, 2)[3], 102);
  assert.equal(px(lower, 2, 1)[3], 201);
});

test('trace contour: a horizontal step uses the up / down neighbours', () => {
  const img = image((x, y) => (y < 1 ? [200, 200, 200, 255] : [10, 10, 10, 255]));
  applyTraceContour(img, 128, 1);
  for (let x = 0; x < W; x++) {
    assert.deepEqual(px(img, x, 0), [0, 0, 0, 255]);
    for (let y = 1; y < H; y++) assert.deepEqual(px(img, x, y), [255, 255, 255, 255]);
  }
});

test('trace contour: channels are traced independently', () => {
  const img = image((x) => [x < 3 ? 50 : 200, 100, 200, 255]);
  applyTraceContour(img, 128, 0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      assert.deepEqual(px(img, x, y), [x === 2 ? 0 : 255, 255, 255, 255], `x=${x} y=${y}`);
    }
  }
  const green = image((x) => [100, x < 3 ? 200 : 50, 100, 255]);
  applyTraceContour(green, 128, 1);
  assert.deepEqual(px(green, 2, 0), [255, 0, 255, 255]);
  assert.deepEqual(px(green, 3, 0), [255, 255, 255, 255]);
});

test('trace contour: v == level counts as not above', () => {
  const img = image((x) => (x < 4 ? [128, 128, 128, 255] : [129, 129, 129, 255]));
  applyTraceContour(img, 128, 0);
  for (const [x, rgb] of columns(img)) {
    assert.deepEqual(rgb, x === 3 ? [0, 0, 0] : [255, 255, 255], `x=${x}`);
  }
  // At level 129 nothing is above, so the image reads as flat.
  const flat = image((x) => (x < 4 ? [128, 128, 128, 255] : [129, 129, 129, 255]));
  applyTraceContour(flat, 129, 0);
  for (const [, rgb] of columns(flat)) assert.deepEqual(rgb, [255, 255, 255]);
});

test('trace contour: the image border repeats', () => {
  // A single bright column at the left border: Upper lines only that column, and
  // only because of its right neighbour. Nothing is drawn along the outer edge of
  // the flat dark region.
  const img = image((x) => (x === 0 ? [200, 200, 200, 255] : [20, 20, 20, 255]));
  applyTraceContour(img, 128, 1);
  for (const [x, rgb] of columns(img)) {
    assert.deepEqual(rgb, x === 0 ? [0, 0, 0] : [255, 255, 255], `x=${x}`);
  }
  // A bright block in the bottom-right corner: Lower lines the dark pixels next to it only.
  const corner = image((x, y) => (x >= 5 && y >= 2 ? [220, 220, 220, 255] : [30, 30, 30, 255]));
  applyTraceContour(corner, 128, 0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const line = (x === 4 && y >= 2) || (y === 1 && x >= 5);
      assert.deepEqual(
        px(corner, x, y).slice(0, 3),
        line ? [0, 0, 0] : [255, 255, 255],
        `${x},${y}`
      );
    }
  }
});

test('trace contour: level clamps and edge rounds / clamps', () => {
  const zeroOne = (x) => (x < 3 ? [0, 0, 0, 255] : [1, 1, 1, 255]);
  const run = (fn, level, edge) => {
    const img = image(fn);
    applyTraceContour(img, level, edge);
    return img.data;
  };
  assert.deepEqual(run(zeroOne, -40, 0), run(zeroOne, 0, 0));
  assert.deepEqual(px({ width: W, height: H, data: run(zeroOne, -40, 0) }, 2, 0), [0, 0, 0, 255]);
  const top = (x) => (x < 3 ? [254, 254, 254, 255] : [255, 255, 255, 255]);
  assert.deepEqual(run(top, 999, 0), run(top, 255, 0));
  assert.deepEqual(px({ width: W, height: H, data: run(top, 254, 1) }, 3, 0), [0, 0, 0, 255]);
  for (const [edge, same] of [
    [0.4, 0],
    [-3, 0],
    [0.6, 1],
    [5, 1]
  ]) {
    assert.deepEqual(run(step, 128, edge), run(step, 128, same), `edge ${edge}`);
  }
  assert.notDeepEqual(run(step, 128, 0), run(step, 128, 1));
});

test('trace contour: the mask limits writes, not reads', () => {
  const img = image(step);
  const orig = image(step);
  const mask = new Uint8Array(W * H);
  mask[1 * W + 2] = 1; // line pixel; its bright neighbour (3, 1) is masked out
  mask[1 * W + 0] = 1; // plain pixel
  mask[3 * W + 5] = 1; // plain pixel on the bright side
  applyTraceContour(img, 128, 0, mask);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let want = px(orig, x, y);
      if (x === 2 && y === 1) want = [0, 0, 0, want[3]];
      else if ((x === 0 && y === 1) || (x === 5 && y === 3)) want = [255, 255, 255, want[3]];
      assert.deepEqual(px(img, x, y), want, `${x},${y}`);
    }
  }
});
