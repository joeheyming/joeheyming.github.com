import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trimBounds, TRIM_BASED_ON } from '../paint/trim.js';
import { COMMANDS } from '../paint/commands.js';
import { STACK_UNDO_LABELS } from '../paint/stack-history.js';

function image(w, h, at) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data.set(at(x, y), (y * w + x) * 4);
  }
  return { width: w, height: h, data };
}

const RED = [255, 0, 0, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

// A 10 x 8 canvas: content in x 3..6, y 2..4.
const inside = (x, y) => x >= 3 && x <= 6 && y >= 2 && y <= 4;

test('Transparent Pixels trims to the non-transparent bounds', () => {
  const img = image(10, 8, (x, y) => (inside(x, y) ? RED : CLEAR));
  assert.deepEqual(trimBounds(img, 'transparent'), { x: 3, y: 2, w: 4, h: 3 });
  // Any alpha above zero counts as content.
  const faint = image(10, 8, (x, y) => (x === 9 && y === 7 ? [0, 0, 0, 1] : CLEAR));
  assert.deepEqual(trimBounds(faint, 'transparent'), { x: 9, y: 7, w: 1, h: 1 });
});

test('Top Left Pixel Color trims away that color', () => {
  const img = image(10, 8, (x, y) => (inside(x, y) ? RED : WHITE));
  assert.deepEqual(trimBounds(img, 'topLeft'), { x: 3, y: 2, w: 4, h: 3 });
  // Opaque white is content when trimming transparency: nothing moves.
  assert.deepEqual(trimBounds(img, 'transparent'), { x: 0, y: 0, w: 10, h: 8 });
});

test('Bottom Right Pixel Color reads the last pixel', () => {
  // The top-left corner is red, so Top Left keeps nearly everything; the bottom right is white.
  const img = image(10, 8, (x, y) => (inside(x, y) || (x === 0 && y === 0) ? RED : WHITE));
  assert.deepEqual(trimBounds(img, 'bottomRight'), { x: 0, y: 0, w: 7, h: 5 });
  assert.deepEqual(trimBounds(img, 'topLeft'), { x: 0, y: 0, w: 10, h: 8 });
});

test('colors compare premultiplied: fully transparent pixels match whatever their RGB', () => {
  const img = image(6, 6, (x, y) =>
    x === 2 && y === 3 ? RED : (x + y) & 1 ? [255, 0, 255, 0] : [0, 255, 0, 0]
  );
  assert.deepEqual(trimBounds(img, 'topLeft'), { x: 2, y: 3, w: 1, h: 1 });
  // A one-level difference is beyond PhotoCraft's half-level tolerance.
  const near = image(4, 4, (x, y) => (x === 1 && y === 1 ? [254, 255, 255, 255] : WHITE));
  assert.deepEqual(trimBounds(near, 'topLeft'), { x: 1, y: 1, w: 1, h: 1 });
});

test('turning a side off keeps that canvas edge', () => {
  const img = image(10, 8, (x, y) => (inside(x, y) ? RED : CLEAR));
  assert.deepEqual(trimBounds(img, 'transparent', { top: false }), { x: 3, y: 0, w: 4, h: 5 });
  assert.deepEqual(trimBounds(img, 'transparent', { bottom: false }), { x: 3, y: 2, w: 4, h: 6 });
  assert.deepEqual(trimBounds(img, 'transparent', { left: false }), { x: 0, y: 2, w: 7, h: 3 });
  assert.deepEqual(trimBounds(img, 'transparent', { right: false }), { x: 3, y: 2, w: 7, h: 3 });
  const none = { top: false, bottom: false, left: false, right: false };
  assert.deepEqual(trimBounds(img, 'transparent', none), { x: 0, y: 0, w: 10, h: 8 });
});

test('an image that would be trimmed away entirely gives null', () => {
  assert.equal(
    trimBounds(
      image(5, 5, () => CLEAR),
      'transparent'
    ),
    null
  );
  assert.equal(
    trimBounds(
      image(5, 5, () => WHITE),
      'topLeft'
    ),
    null
  );
  assert.equal(
    trimBounds(
      image(5, 5, () => WHITE),
      'bottomRight'
    ),
    null
  );
});

test('the bounds crop the layer pixels to the content', () => {
  const img = image(10, 8, (x, y) => (inside(x, y) ? [x * 20, y * 30, 0, 255] : CLEAR));
  const r = trimBounds(img, 'transparent');
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const from = ((r.y + y) * img.width + r.x) * 4;
    out.set(img.data.subarray(from, from + r.w * 4), y * r.w * 4);
  }
  for (let i = 3; i < out.length; i += 4) assert.equal(out[i], 255);
  assert.deepEqual(Array.from(out.slice(0, 4)), [60, 60, 0, 255]);
  assert.deepEqual(Array.from(out.slice(-4)), [120, 120, 0, 255]);
});

test('Image › Trim… is a command with a whole-stack undo', () => {
  const cmd = COMMANDS.find((c) => c.id === 'image.trim');
  assert.ok(cmd);
  assert.equal(cmd.label, 'Trim…');
  assert.deepEqual(cmd.menu, ['Image']);
  let opened = 0;
  cmd.run({ trim: () => opened++ });
  assert.equal(opened, 1);
  assert.ok(STACK_UNDO_LABELS.has('Trim'));
  assert.deepEqual(
    TRIM_BASED_ON.map((o) => o.label),
    ['Transparent Pixels', 'Top Left Pixel Color', 'Bottom Right Pixel Color']
  );
});
