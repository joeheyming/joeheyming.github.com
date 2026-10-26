// Ruler Straighten on the background layer (PhotoCraft analysis_cmds.rs straighten with crop,
// inscribed): turn the canvas, then crop to the largest inscribed rectangle.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  inscribedSize,
  straightenCropRect,
  rotateImageData,
  rotatedSize
} from '../paint/transform.js';

const round4 = (v) => Math.round(v * 1e4) / 1e4;
const rad = (deg) => (deg * Math.PI) / 180;

test('inscribedSize ports PhotoCraft inscribed', () => {
  assert.deepEqual(inscribedSize(200, 100, rad(10)).map(round4), [191.1229, 67.8425]);
  assert.deepEqual(inscribedSize(200, 100, rad(45)).map(round4), [70.7107, 70.7107]);
  assert.deepEqual(inscribedSize(200, 100, 0), [200, 100]);
  assert.deepEqual(inscribedSize(37, 21, 0), [37, 21]);
});

test('inscribedSize swaps for a tall image', () => {
  assert.deepEqual(inscribedSize(100, 200, rad(10)).map(round4), [67.8425, 191.1229]);
  assert.deepEqual(inscribedSize(10, 200, rad(30)).map(round4), [5.7735, 10]);
});

test('straightenCropRect centres the floored inscribed size in the turned canvas', () => {
  const { width: nw, height: nh } = rotatedSize(200, 100, 10);
  const r = straightenCropRect(200, 100, nw, nh, 10);
  assert.equal(r.width, 191);
  assert.equal(r.height, 67);
  assert.equal(r.x, Math.round((nw - 191) / 2));
  assert.equal(r.y, Math.round((nh - 67) / 2));
  assert.deepEqual(straightenCropRect(200, 100, 200, 100, -10), {
    x: Math.round((200 - 191) / 2),
    y: Math.round((100 - 67) / 2),
    width: 191,
    height: 67
  });
});

test('straightenCropRect clamps to the turned size and to at least 1 x 1', () => {
  assert.deepEqual(straightenCropRect(200, 100, 150, 50, 0), {
    x: 0,
    y: 0,
    width: 150,
    height: 50
  });
  const tiny = straightenCropRect(1, 1, 2, 2, 45);
  assert.equal(tiny.width, 1);
  assert.equal(tiny.height, 1);
  assert.ok(tiny.x >= 0 && tiny.y >= 0);
});

function opaque(W, H) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    data[p * 4] = (p * 7) % 256;
    data[p * 4 + 1] = (p * 13) % 256;
    data[p * 4 + 2] = 90;
    data[p * 4 + 3] = 255;
  }
  return { width: W, height: H, data };
}

const CASES = [
  [40, 24, 7],
  [40, 24, -12],
  [24, 40, 5.7106],
  [30, 30, -30]
];

test('the bottom layer turned with the background fill then cropped is opaque everywhere', () => {
  for (const [W, H, deg] of CASES) {
    const turned = rotateImageData(opaque(W, H), deg, [255, 255, 255, 255]);
    const r = straightenCropRect(W, H, turned.width, turned.height, deg);
    assert.ok(r.x + r.width <= turned.width && r.y + r.height <= turned.height);
    for (let y = r.y; y < r.y + r.height; y++) {
      for (let x = r.x; x < r.x + r.width; x++) {
        assert.equal(turned.data[(y * turned.width + x) * 4 + 3], 255);
      }
    }
  }
});

test('the crop stays off the corners the turn uncovers', () => {
  for (const [W, H, deg] of CASES) {
    const turned = rotateImageData(opaque(W, H), deg);
    // The turn really uncovers transparent corners.
    assert.equal(turned.data[3], 0);
    const r = straightenCropRect(W, H, turned.width, turned.height, deg);
    for (let y = r.y; y < r.y + r.height; y++) {
      for (let x = r.x; x < r.x + r.width; x++) {
        const a = turned.data[(y * turned.width + x) * 4 + 3];
        const inner = x > r.x && x < r.x + r.width - 1 && y > r.y && y < r.y + r.height - 1;
        // Only the crop's outermost ring may touch the antialiased edge of the turned image.
        assert.ok(inner ? a === 255 : a > 0, `${W}x${H} ${deg}° (${x}, ${y}) alpha ${a}`);
      }
    }
  }
});
