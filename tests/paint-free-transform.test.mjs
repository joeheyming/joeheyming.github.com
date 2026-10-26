import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildMenuBar } from '../paint/menu-bar.js';
import { COMMANDS } from '../paint/commands.js';

import {
  IDENTITY_TRANSFORM,
  freeTransformAffine,
  freeTransformPointer,
  transformImageData,
  rotateImageData,
  liftForTransform,
  opaqueBBox,
  hitFreeTransform,
  dragFreeTransform
} from '../paint/transform.js';
import { historyIconName, FALLBACK_HISTORY_ICON } from '../paint/history.js';
import { ICONS } from '../paint/icons.js';

function image(W, H, px) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) data.set(px(p % W, Math.floor(p / W)), p * 4);
  return { width: W, height: H, data };
}

const at = (img, x, y) =>
  Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

const inside = (b, x, y) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;

test('an identity affine returns the same pixels', () => {
  const src = image(5, 4, (x, y) => [x * 50, y * 60, 9, 100 + x * 30]);
  const box = { x: 0, y: 0, w: 5, h: 4 };
  const out = transformImageData(src, box, freeTransformAffine(box, IDENTITY_TRANSFORM));
  assert.deepEqual(Array.from(out.data), Array.from(src.data));
});

test('a 2x scale of a 2 x 2 block covers a 4 x 4 block about the box centre', () => {
  const box = { x: 2, y: 2, w: 2, h: 2 };
  const src = image(8, 8, (x, y) => (inside(box, x, y) ? [200, 40, 10, 255] : [0, 0, 0, 0]));
  const affine = freeTransformAffine(box, { ...IDENTITY_TRANSFORM, sx: 2, sy: 2 });
  const out = transformImageData(src, box, affine);
  const covered = { x: 1, y: 1, w: 4, h: 4 };
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (inside(covered, x, y)) assert.deepEqual(at(out, x, y), [200, 40, 10, 255], `${x},${y}`);
      else assert.equal(at(out, x, y)[3], 0, `${x},${y}`);
    }
  }
});

test('a 90 degree rotation matches rotateImageData quarter turn inside the box', () => {
  const box = { x: 3, y: 2, w: 2, h: 4 };
  const src = image(10, 8, (x, y) =>
    inside(box, x, y) ? [(x - 3) * 100, (y - 2) * 60, 30, 255] : [0, 0, 0, 0]
  );
  const block = image(2, 4, (x, y) => at(src, box.x + x, box.y + y));
  const turned = rotateImageData(block, 90);
  const affine = freeTransformAffine(box, { ...IDENTITY_TRANSFORM, angle: Math.PI / 2 });
  const out = transformImageData(src, box, affine);
  // The turned 4 × 2 box shares the source box's centre (4, 4).
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 4; x++) assert.deepEqual(at(out, 2 + x, 3 + y), at(turned, x, y));
  }
});

test('pixels outside the transformed box are transparent', () => {
  const src = image(12, 12, () => [255, 255, 255, 255]);
  const box = { x: 4, y: 4, w: 4, h: 4 };
  const affine = freeTransformAffine(box, { tx: 1, ty: 0, sx: 1, sy: 1, angle: Math.PI / 4 });
  const out = transformImageData(src, box, affine);
  // Corners of the canvas and points beyond the diamond's reach stay clear.
  for (const [x, y] of [
    [0, 0],
    [11, 11],
    [5, 3],
    [2, 6],
    [10, 2]
  ]) {
    assert.equal(at(out, x, y)[3], 0, `${x},${y}`);
  }
  assert.equal(at(out, 7, 6)[3], 255);
});

test('a Shift corner drag maps to a uniform scale anchored at the opposite corner', () => {
  const box = { x: 0, y: 0, w: 10, h: 10 };
  const t0 = { ...IDENTITY_TRANSFORM };
  const grab = hitFreeTransform(box, t0, 10, 10, 2);
  assert.deepEqual(grab, { hx: 1, hy: 1 });
  const t = dragFreeTransform(box, t0, grab, { x: 10, y: 10 }, { x: 20, y: 15 }, true);
  assert.equal(t.sx, 2);
  assert.equal(t.sy, 2);
  const [a, b, c, d, e, f] = freeTransformAffine(box, t);
  // The top-left corner stays put and the bottom-right lands at (20, 20).
  assert.deepEqual([e, f], [0, 0]);
  assert.deepEqual([a * 10 + c * 10 + e, b * 10 + d * 10 + f], [20, 20]);
  // Without Shift the axes scale separately.
  const free = dragFreeTransform(box, t0, grab, { x: 10, y: 10 }, { x: 20, y: 15 }, false);
  assert.equal(free.sx, 2);
  assert.equal(free.sy, 1.5);
});

test('inside the box moves, outside rotates about the centre', () => {
  const box = { x: 0, y: 0, w: 10, h: 10 };
  const t0 = { ...IDENTITY_TRANSFORM };
  assert.equal(hitFreeTransform(box, t0, 5, 5, 1), 'move');
  assert.equal(hitFreeTransform(box, t0, 20, 5, 1), 'rotate');
  assert.deepEqual(hitFreeTransform(box, t0, 5, 0, 1), { hx: 0, hy: -1 });
  const t = dragFreeTransform(box, t0, 'rotate', { x: 15, y: 5 }, { x: 5, y: 15 });
  assert.ok(Math.abs(t.angle - Math.PI / 2) < 1e-12);
  assert.equal(t.tx, 0);
  const moved = dragFreeTransform(box, t0, 'move', { x: 5, y: 5 }, { x: 8, y: 1 });
  assert.deepEqual([moved.tx, moved.ty], [3, -4]);
});

test('liftForTransform splits the selection from the layer', () => {
  const src = image(3, 1, (x) => [x * 80, 0, 0, 255]);
  const mask = new Uint8Array([0, 1, 0]);
  const { source, base } = liftForTransform(src, mask, null);
  assert.deepEqual(at(source, 0, 0)[3], 0);
  assert.deepEqual(at(source, 1, 0), [80, 0, 0, 255]);
  assert.deepEqual(at(base, 1, 0), [0, 0, 0, 0]);
  assert.deepEqual(at(base, 2, 0), [160, 0, 0, 255]);
  const filled = liftForTransform(src, mask, [9, 9, 9, 255]).base;
  assert.deepEqual(at(filled, 1, 0), [9, 9, 9, 255]);
  assert.deepEqual(opaqueBBox(source), { x: 1, y: 0, w: 1, h: 1 });
});

test('Edit menu has Free Transform', () => {
  const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
  const { document } = new JSDOM(html).window;
  const prevDoc = globalThis.document;
  globalThis.document = document;
  try {
    buildMenuBar(document.getElementById('menu-bar'), COMMANDS, {
      mac: false,
      state: { layers: [], sel: { ids: [] } }
    });
    const item = document.querySelector('#edit-menu-list #btn-free-transform');
    assert.ok(item, 'Free Transform missing from the Edit menu');
    assert.equal(item.querySelector('.menu-label').textContent, 'Free Transform');
    assert.equal(item.querySelector('.menu-shortcut').textContent, 'Ctrl+T');
  } finally {
    globalThis.document = prevDoc;
  }
});

test("'Free Transform' has a history icon", () => {
  const name = historyIconName('Free Transform');
  assert.notEqual(name, FALLBACK_HISTORY_ICON);
  assert.ok(ICONS[name], name);
});

test('freeTransformPointer moves the box through the transform Seam', () => {
  const box = { x: 10, y: 10, w: 40, h: 40 };
  const ft = {
    box,
    t: { ...IDENTITY_TRANSFORM },
    quad: null,
    mesh: null,
    mode: 'free',
    drag: null
  };
  const cursors = [];
  const ports = {
    zoom: 1,
    setCursor: (c) => cursors.push(c),
    redraw: () => {}
  };
  // Grab the centre (move) and drag 5 px right.
  freeTransformPointer(ft, 'down', 30, 30, { shift: false }, ports);
  assert.equal(ft.drag?.grab, 'move');
  freeTransformPointer(ft, 'move', 35, 30, { shift: false }, ports);
  assert.equal(ft.t.tx, 5);
  assert.equal(ft.t.ty, 0);
  freeTransformPointer(ft, 'up', 35, 30, { shift: false }, ports);
  assert.equal(ft.drag, null);
});
