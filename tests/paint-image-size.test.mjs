import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromUnit, linkedSize, resample, toUnit } from '../paint/image-size.js';
import { COMMANDS } from '../paint/commands.js';
import { STACK_UNDO_LABELS } from '../paint/stack-history.js';

function image(w, h, at) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data.set(at(x, y), (y * w + x) * 4);
  }
  return { width: w, height: h, data };
}

const px = (img, x, y) =>
  Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

test('nearest keeps exact colors when enlarging and reducing', () => {
  const colors = [
    [255, 0, 0, 255],
    [0, 128, 255, 255],
    [10, 200, 30, 128]
  ];
  const src = image(3, 1, (x) => colors[x]);
  const up = resample(src, 9, 3, 'nearest');
  assert.deepEqual([up.width, up.height], [9, 3]);
  for (let x = 0; x < 9; x++) assert.deepEqual(px(up, x, 1), colors[Math.floor(x / 3)]);
  const checker = image(8, 8, (x, y) => ((x + y) & 1 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
  const down = resample(checker, 2, 2, 'nearest');
  const allowed = new Set(['0,0,0,255', '255,255,255,255']);
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) assert.ok(allowed.has(px(down, x, y).join()));
  }
});

test('bilinear averages the two neighbours at the midpoint', () => {
  const src = image(2, 1, (x) => (x ? [200, 100, 0, 255] : [0, 0, 200, 255]));
  const out = resample(src, 3, 1, 'bilinear');
  assert.deepEqual(px(out, 0, 0), [0, 0, 200, 255]);
  assert.deepEqual(px(out, 1, 0), [100, 50, 100, 255]);
  assert.deepEqual(px(out, 2, 0), [200, 100, 0, 255]);
});

test('bilinear reduces by more than 2x with a box average', () => {
  // Stripes of 0 / 255 four px wide: a plain point sample would land on one stripe.
  const src = image(16, 1, (x) => (x & 1 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
  const out = resample(src, 4, 1, 'bilinear');
  for (let x = 0; x < 4; x++) assert.ok(Math.abs(px(out, x, 0)[0] - 127.5) <= 1);
  const cubic = resample(src, 4, 1, 'bicubic');
  for (let x = 0; x < 4; x++) assert.ok(Math.abs(px(cubic, x, 0)[0] - 127.5) <= 1);
});

test('bicubic preserves a flat field', () => {
  const flat = [37, 140, 222, 200];
  const src = image(7, 5, () => flat);
  for (const [w, h] of [
    [17, 11],
    [3, 2],
    [7, 13],
    [1, 1]
  ]) {
    const out = resample(src, w, h, 'bicubic');
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) assert.deepEqual(px(out, x, y), flat);
    }
  }
});

test('bicubic stays inside 0..255 across a hard edge', () => {
  const src = image(4, 1, (x) => (x < 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  const out = resample(src, 16, 1, 'bicubic');
  const row = Array.from({ length: 16 }, (_, x) => px(out, x, 0)[0]);
  assert.equal(row[0], 0);
  assert.equal(row[15], 255);
  for (let x = 1; x < 16; x++) assert.ok(row[x] >= row[x - 1], 'monotone after clamping');
});

test('transparent pixels do not darken the colour (premultiplied)', () => {
  const src = image(2, 1, (x) => (x ? [255, 0, 0, 255] : [0, 0, 0, 0]));
  const mid = px(resample(src, 3, 1, 'bilinear'), 1, 0);
  assert.deepEqual(mid, [255, 0, 0, 128]);
});

test('Constrain Proportions keeps the aspect, rounding the other side', () => {
  assert.deepEqual(
    linkedSize({
      origW: 800,
      origH: 600,
      width: 400,
      height: 600,
      edited: 'width',
      constrain: true
    }),
    { width: 400, height: 300 }
  );
  assert.deepEqual(
    linkedSize({
      origW: 800,
      origH: 600,
      width: 800,
      height: 100,
      edited: 'height',
      constrain: true
    }),
    { width: 133, height: 100 }
  );
  assert.deepEqual(
    linkedSize({
      origW: 800,
      origH: 600,
      width: 400,
      height: 600,
      edited: 'width',
      constrain: false
    }),
    { width: 400, height: 600 }
  );
  assert.deepEqual(
    linkedSize({ origW: 1000, origH: 10, width: 10, height: 10, edited: 'width', constrain: true }),
    { width: 10, height: 1 }
  );
});

test('percent units convert against the original side', () => {
  assert.equal(fromUnit(50, 'percent', 800), 400);
  assert.equal(toUnit(400, 'percent', 800), 50);
  assert.equal(fromUnit(321, 'px', 800), 321);
  assert.deepEqual(
    linkedSize({
      origW: 640,
      origH: 480,
      width: fromUnit(25, 'percent', 640),
      height: 480,
      edited: 'width',
      constrain: true
    }),
    { width: 160, height: 120 }
  );
});

test('Image Size… is a command that resizes the document under one stack undo', () => {
  const cmd = COMMANDS.find((c) => c.id === 'image.imageSize');
  assert.ok(cmd, 'image.imageSize command');
  assert.equal(cmd.menu[0], 'Image');
  assert.equal(cmd.shortcut, 'Cmd+Alt+I');
  let opened = 0;
  cmd.run({ imageSize: () => opened++ });
  assert.equal(opened, 1);
  assert.ok(STACK_UNDO_LABELS.has('Image Size'));
});
