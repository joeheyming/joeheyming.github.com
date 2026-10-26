import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildMenuBar } from '../paint/menu-bar.js';
import { COMMANDS } from '../paint/commands.js';

import { rotatedSize, rotateImageData } from '../paint/transform.js';
import { historyIconName, FALLBACK_HISTORY_ICON } from '../paint/history.js';
import { ICONS } from '../paint/icons.js';

function image(W, H, px) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) data.set(px(p % W, Math.floor(p / W)), p * 4);
  return { width: W, height: H, data };
}

const at = (img, x, y) =>
  Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

test('rotatedSize ports PhotoCraft rotated_size', () => {
  assert.deepEqual(rotatedSize(40, 20, 90), { width: 20, height: 40 });
  assert.deepEqual(rotatedSize(40, 20, 180), { width: 40, height: 20 });
  assert.deepEqual(rotatedSize(40, 20, 360), { width: 40, height: 20 });
  const s = rotatedSize(40, 20, 30);
  assert.ok(s.width > 40 && s.height > 20, JSON.stringify(s));
  assert.deepEqual(rotatedSize(1, 1, 0), { width: 1, height: 1 });
});

test('90° clockwise moves the top-left pixel to the top-right exactly', () => {
  const src = image(3, 2, (x, y) => [x * 10, y * 10, 7, 255]);
  const out = rotateImageData(src, 90, null);
  assert.equal(out.width, 2);
  assert.equal(out.height, 3);
  assert.deepEqual(at(out, 1, 0), at(src, 0, 0));
  // Every pixel moves exactly: (x, y) → (H − 1 − y, x).
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 3; x++) assert.deepEqual(at(out, 1 - y, x), at(src, x, y));
});

test('90° counter clockwise is the inverse of 90° clockwise', () => {
  const src = image(3, 2, (x, y) => [x * 40, y * 90, 3, 200]);
  const back = rotateImageData(rotateImageData(src, 90, null), -90, null);
  assert.deepEqual(Array.from(back.data), Array.from(src.data));
});

test('180° reverses pixel order exactly', () => {
  const src = image(4, 3, (x, y) => [x * 50, y * 70, (x + y) * 20, 255 - x]);
  const out = rotateImageData(src, 180, null);
  assert.equal(out.width, 4);
  assert.equal(out.height, 3);
  const n = 12;
  for (let p = 0; p < n; p++) {
    assert.deepEqual(
      Array.from(out.data.slice(p * 4, p * 4 + 4)),
      Array.from(src.data.slice((n - 1 - p) * 4, (n - 1 - p) * 4 + 4))
    );
  }
});

test('30° exposes corners: background fill or transparent', () => {
  const src = image(40, 20, () => [200, 50, 50, 255]);
  const filled = rotateImageData(src, 30, [0, 255, 0, 255]);
  assert.deepEqual(at(filled, 0, 0), [0, 255, 0, 255]);
  const bare = rotateImageData(src, 30, null);
  assert.equal(at(bare, 0, 0)[3], 0);
  // The centre is still source pixels.
  const c = at(bare, bare.width >> 1, bare.height >> 1);
  assert.deepEqual(c, [200, 50, 50, 255]);
});

test('a centred red square stays centred after 90°', () => {
  const src = image(20, 10, (x, y) =>
    x >= 8 && x < 12 && y >= 3 && y < 7 ? [255, 0, 0, 255] : [0, 0, 0, 0]
  );
  const out = rotateImageData(src, 90, null);
  assert.equal(out.width, 10);
  assert.equal(out.height, 20);
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 10; x++) {
      const red = x >= 3 && x < 7 && y >= 8 && y < 12;
      assert.equal(at(out, x, y)[3], red ? 255 : 0, `${x},${y}`);
    }
  }
});

test('360° returns the same size and pixels', () => {
  const src = image(5, 3, (x, y) => [x * 30, y * 60, 9, 128]);
  const out = rotateImageData(src, 360, null);
  assert.equal(out.width, 5);
  assert.equal(out.height, 3);
  assert.deepEqual(Array.from(out.data), Array.from(src.data));
});

test('Image menu has the Image Rotation items and the Arbitrary modal', () => {
  const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
  const { document } = new JSDOM(html).window;
  buildMenuBar(document.getElementById('menu-bar'), COMMANDS, { mac: false });
  const group = document.querySelector(
    '#image-menu-list .has-submenu[data-menu-path="Image > Image Rotation"]'
  );
  assert.ok(group, 'Image Rotation submenu');
  const ids = [...group.querySelectorAll('button.action-menu-item')].map((b) => b.id);
  assert.deepEqual(ids, [
    'btn-rotate-180',
    'btn-rotate-cw',
    'btn-rotate-ccw',
    'btn-rotate-arbitrary',
    'btn-flip-canvas-h',
    'btn-flip-canvas-v'
  ]);
  assert.ok(document.querySelector('#rotate-modal.modal #rotate-angle[type=number]'));
  const dirs = [...document.querySelectorAll('#rotate-direction option')].map((o) => o.value);
  assert.deepEqual(dirs, ['cw', 'ccw']);
});

test('paint.js pushes Rotate Canvas undo and resizes through resizeStack', () => {
  const src = readFileSync(new URL('../paint/paint.js', import.meta.url), 'utf8');
  const body = src.slice(
    src.indexOf('function rotateCanvas'),
    src.indexOf('function openRotateModal')
  );
  assert.ok(body.indexOf("pushUndo('Rotate Canvas')") < body.indexOf('resizeStack('));
  assert.match(body, /state\.sel\.mode = 'none'/);
  assert.doesNotMatch(src, /window\.prompt|[^.]prompt\(/);
});

test("'Rotate Canvas' has a history icon", () => {
  const name = historyIconName('Rotate Canvas');
  assert.notEqual(name, FALLBACK_HISTORY_ICON);
  assert.equal(name, 'rotate-cw');
  assert.ok(ICONS[name]);
});
